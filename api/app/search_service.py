"""Acceso HTTP al modelo BGE-M3 y a las dos búsquedas vectoriales de Supabase."""
import logging
import re
import time

import httpx
from app.embedding_service import embed_with_fallback

MODEL='@cf/baai/bge-m3'
logger=logging.getLogger('uvicorn.error')


def upstream_error(response:httpx.Response,config:dict) -> str:
    """Extrae únicamente campos diagnósticos; nunca cuerpos completos ni credenciales."""
    try:
        body=response.json()
        if isinstance(body,dict):
            if isinstance(body.get('errors'),list):
                errors=[f"{error.get('code')}: {error.get('message')}" for error in body['errors'][:2] if isinstance(error,dict)]
                message='; '.join(errors)
            else:
                message=' | '.join(f'{key}: {body[key]}' for key in ('code','message','hint') if isinstance(body.get(key),(str,int)))
        else:message='respuesta de error sin detalles JSON'
    except ValueError:
        message='respuesta de error sin detalles JSON'
    for secret in (config.get('CLOUDFLARE_API_TOKEN'),config.get('SUPABASE_SECRET_KEY'),config.get('EMBEDDING_REMOTE_API_KEY')):
        if secret:message=message.replace(secret,'[redactado]')
    message=re.sub(r'(?i)(bearer\s+|sb_secret_|sk-)[^\s,;"\']+',r'\1[redactado]',message)
    return message[:300]


async def post_logged(client:httpx.AsyncClient,stage:str,url:str,config:dict,trace_id:str,**kwargs) -> httpx.Response:
    start=time.monotonic()
    logger.info('search trace=%s stage=%s start',trace_id,stage)
    try:
        response=await client.post(url,**kwargs)
    except httpx.RequestError as exc:
        logger.error('search trace=%s stage=%s network_error=%s elapsed_ms=%d',
                     trace_id,stage,type(exc).__name__,int((time.monotonic()-start)*1000))
        raise
    duration=int((time.monotonic()-start)*1000)
    if response.is_error:
        logger.error('search trace=%s stage=%s upstream_status=%d elapsed_ms=%d detail=%s',
                     trace_id,stage,response.status_code,duration,upstream_error(response,config))
    else:
        logger.info('search trace=%s stage=%s upstream_status=%d elapsed_ms=%d',trace_id,stage,response.status_code,duration)
    response.raise_for_status()
    return response


async def embed_query(client:httpx.AsyncClient,config:dict,query:str,trace_id:str='direct') -> list[float]:
    return await embed_with_fallback(client,config,query,trace_id,post_logged)


async def fetch_candidates(client:httpx.AsyncClient,config:dict,vector:list[float],eligible_ids:list[str]|None=None,trace_id:str='direct') -> tuple[list[dict],list[dict]]:
    base=config['SUPABASE_URL'].rstrip('/')+'/rest/v1/rpc/'
    headers={'apikey':config['SUPABASE_SECRET_KEY']}
    extra={'eligible_ids':eligible_ids} if eligible_ids is not None else {}
    songs=await post_logged(client,'supabase_search_songs_labeled',base+'search_songs_labeled',config,trace_id,
                            headers=headers,json={'query_embedding':vector,'match_count':200,**extra})
    parts=await post_logged(client,'supabase_search_song_sections',base+'search_song_sections',config,trace_id,
                            headers=headers,json={'query_embedding':vector,'match_count':250,**extra})
    try:song_rows,section_rows=songs.json(),parts.json()
    except ValueError:
        logger.error('search trace=%s stage=supabase_decode invalid_json',trace_id)
        raise
    if not isinstance(song_rows,list) or not isinstance(section_rows,list):
        logger.error('search trace=%s stage=supabase_decode invalid_response songs_type=%s sections_type=%s',
                     trace_id,type(song_rows).__name__,type(section_rows).__name__)
        raise ValueError('Supabase no devolvió listas de cantos y secciones')
    logger.info('search trace=%s stage=supabase_candidates songs=%d sections=%d',trace_id,len(song_rows),len(section_rows))
    return song_rows,section_rows
