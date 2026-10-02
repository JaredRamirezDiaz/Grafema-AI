"""Embeddings BGE-M3 configurables. Solo se genera el vector de la consulta."""
import asyncio
from functools import lru_cache
import logging
import math
import os
import re
from threading import Lock
from urllib.parse import quote, urlparse

import httpx

logger = logging.getLogger('uvicorn.error')
CLOUDFLARE_MODEL = '@cf/baai/bge-m3'
SUPPORTED = {'local', 'cloudflare', 'remote'}
_local_lock = Lock()  # Un modelo por proceso; limita la memoria usada por búsquedas simultáneas.


def provider_order() -> list[str]:
    providers = [item.strip().lower() for item in os.getenv('EMBEDDING_PROVIDERS', 'cloudflare').split(',')]
    if not providers or any(item not in SUPPORTED for item in providers) or len(set(providers)) != len(providers):
        raise ValueError('EMBEDDING_PROVIDERS debe ser una lista única de local,cloudflare,remote')
    return providers


def checked_vector(value: object, provider: str) -> list[float]:
    if not isinstance(value, (list, tuple)) or len(value) != 1024:
        raise ValueError(f'{provider}: se esperaban 1024 dimensiones')
    try:
        vector = [float(number) for number in value]
    except (TypeError, ValueError) as exc:
        raise ValueError(f'{provider}: el vector contiene valores no numéricos') from exc
    if not all(math.isfinite(number) for number in vector) or not any(vector):
        raise ValueError(f'{provider}: el vector contiene valores inválidos')
    return vector


def _device() -> str:
    requested = os.getenv('EMBEDDING_LOCAL_DEVICE', 'auto').lower().strip()
    if requested not in ('auto', 'cpu', 'cuda') and not re.fullmatch(r'cuda:\d+', requested):
        raise ValueError('EMBEDDING_LOCAL_DEVICE debe ser auto, cpu o cuda:0')
    if requested == 'cpu':
        return 'cpu'
    import torch
    if requested == 'auto':
        return 'cuda:0' if torch.cuda.is_available() else 'cpu'
    if not torch.cuda.is_available():
        raise RuntimeError('PyTorch no detecta una GPU CUDA; instala la versión CUDA adecuada o usa cpu')
    return 'cuda:0' if requested == 'cuda' else requested


@lru_cache(maxsize=1)
def _load_local(model_name: str, device: str):
    try:
        from FlagEmbedding import BGEM3FlagModel
    except ImportError as exc:
        raise RuntimeError('Instala api/requirements-local.txt para usar BGE-M3 local') from exc
    logger.info('embedding stage=local_model_load device=%s', device)
    model = BGEM3FlagModel(model_name, devices=device, use_fp16=device.startswith('cuda'))
    logger.info('embedding stage=local_model_ready device=%s', device)
    return model


def _encode_local(query: str) -> list[float]:
    model_name = os.getenv('EMBEDDING_LOCAL_MODEL', 'BAAI/bge-m3')
    # El índice actual contiene vectores BGE-M3. Otros modelos exigen reindexar todo.
    if model_name != 'BAAI/bge-m3' and not os.path.isdir(model_name):
        raise ValueError('EMBEDDING_LOCAL_MODEL debe ser BAAI/bge-m3 o una carpeta local del mismo modelo')
    device = _device()
    with _local_lock:
        model = _load_local(model_name, device)
        values = model.encode([query], batch_size=1, return_dense=True,
                              return_sparse=False, return_colbert_vecs=False)['dense_vecs'][0]
        return checked_vector(values.tolist(), 'local')


async def _cloudflare(client: httpx.AsyncClient, config: dict, query: str, trace_id: str, post_logged) -> list[float]:
    account, token = config.get('CLOUDFLARE_ACCOUNT_ID'), config.get('CLOUDFLARE_API_TOKEN')
    if not account or not token:
        raise ValueError('Faltan CLOUDFLARE_ACCOUNT_ID o CLOUDFLARE_API_TOKEN')
    url = f'https://api.cloudflare.com/client/v4/accounts/{quote(account,safe="")}/ai/run/{CLOUDFLARE_MODEL}'
    response = await post_logged(client, 'cloudflare_embedding', url, config, trace_id,
                                 headers={'Authorization': f'Bearer {token}'}, json={'text': [query]})
    body = response.json()
    if not isinstance(body, dict) or body.get('success') is not True or not isinstance(body.get('result'), dict):
        raise ValueError('Cloudflare no devolvió un embedding BGE-M3 válido')
    data = body['result'].get('data')
    if not isinstance(data, list) or len(data) != 1:
        raise ValueError('Cloudflare no devolvió un vector')
    return checked_vector(data[0], 'cloudflare')


async def _remote(client: httpx.AsyncClient, config: dict, query: str, trace_id: str, post_logged) -> list[float]:
    url = config.get('EMBEDDING_REMOTE_URL', '')
    parsed = urlparse(url)
    if not parsed.hostname or (parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname in ('localhost', '127.0.0.1'))):
        raise ValueError('EMBEDDING_REMOTE_URL debe ser HTTPS o localhost')
    model = config.get('EMBEDDING_REMOTE_MODEL') or 'BAAI/bge-m3'
    if model != 'BAAI/bge-m3':
        raise ValueError('El endpoint remoto debe generar vectores BAAI/bge-m3 para este índice')
    token = config.get('EMBEDDING_REMOTE_API_KEY', '')
    headers = {'Authorization': f'Bearer {token}'} if token else {}
    response = await post_logged(client, 'remote_embedding', url, config, trace_id, headers=headers,
                                 json={'model': model, 'input': query})
    body = response.json()
    if not isinstance(body, dict) or not isinstance(body.get('data'), list) or not body['data']:
        raise ValueError('El endpoint remoto no devolvió data[0].embedding')
    return checked_vector(body['data'][0].get('embedding') if isinstance(body['data'][0], dict) else None, 'remote')


async def embed_with_fallback(client: httpx.AsyncClient, config: dict, query: str, trace_id: str, post_logged) -> list[float]:
    providers = provider_order()
    last_error = None
    for provider in providers:
        try:
            logger.info('search trace=%s stage=embedding provider=%s start', trace_id, provider)
            if provider == 'local':
                vector = await asyncio.to_thread(_encode_local, query)
            elif provider == 'cloudflare':
                vector = await _cloudflare(client, config, query, trace_id, post_logged)
            else:
                vector = await _remote(client, config, query, trace_id, post_logged)
            logger.info('search trace=%s stage=embedding provider=%s ready', trace_id, provider)
            return vector
        except (httpx.HTTPError, ValueError, RuntimeError, ImportError, OSError, KeyError, TypeError) as exc:
            last_error = exc
            logger.error('search trace=%s stage=embedding provider=%s failed error_type=%s',
                         trace_id, provider, type(exc).__name__)
            if provider != providers[-1]:
                logger.warning('search trace=%s stage=embedding fallback=%s', trace_id, providers[providers.index(provider)+1])
    if isinstance(last_error,httpx.HTTPError):
        raise last_error
    raise ValueError('No hay un proveedor de embeddings BGE-M3 disponible; revisa los logs del mismo trace')
