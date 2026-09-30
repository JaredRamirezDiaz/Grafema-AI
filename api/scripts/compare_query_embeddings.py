"""Compara BGE-M3 local con los vectores de Cloudflare antes de alternar proveedores.

Uso: python -m scripts.compare_query_embeddings (consume tres llamadas Cloudflare).
"""
import asyncio
import math
import os

import httpx
from dotenv import load_dotenv

from app.embedding_service import _cloudflare, _encode_local
from app.search_service import post_logged

QUERIES = [
    'Cantos que hablen de la segunda venida de Jesús',
    'Gratitud por la fidelidad de Dios en tiempos difíciles',
    'Alabanza congregacional de energía alta para la apertura',
]


def cosine(left: list[float], right: list[float]) -> float:
    dot = sum(a*b for a,b in zip(left,right))
    return dot/math.sqrt(sum(a*a for a in left)*sum(b*b for b in right))


async def compare() -> None:
    load_dotenv()
    config = {key: os.getenv(key,'') for key in ('CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_API_TOKEN')}
    if not all(config.values()):
        raise SystemExit('Faltan CLOUDFLARE_ACCOUNT_ID o CLOUDFLARE_API_TOKEN en api/.env')
    async with httpx.AsyncClient(timeout=45) as client:
        for index, query in enumerate(QUERIES,1):
            local = await asyncio.to_thread(_encode_local,query)
            cloudflare = await _cloudflare(client,config,query,f'compare-{index}',post_logged)
            print(f'{index}. Similitud coseno local/Cloudflare: {cosine(local,cloudflare):.6f}')
    print('Compara además la calidad con las 23 consultas del benchmark antes de usar el proveedor nuevo en producción.')


if __name__ == '__main__':
    asyncio.run(compare())
