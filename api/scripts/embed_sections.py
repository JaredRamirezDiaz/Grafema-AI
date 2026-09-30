"""Genera embeddings BGE-M3 por sección con caché y sube los vectores a Supabase.

Desde api/: python -m scripts.embed_sections --limit 50
           python -m scripts.embed_sections          # continúa los pendientes
"""
import argparse
import json
import os
import time
from pathlib import Path
from urllib.parse import quote

import httpx
from dotenv import load_dotenv
from scripts.label_data import ROOT,load_rows

load_dotenv(ROOT/'api'/'.env')
MODEL='@cf/baai/bge-m3'
CACHE=ROOT/'data'/'section_embeddings_bge_m3.json'


def embed(client:httpx.Client, texts:list[str], account:str, token:str) -> list[list[float]]:
    url=f'https://api.cloudflare.com/client/v4/accounts/{quote(account,safe="")}/ai/run/{MODEL}'
    for attempt in range(4):
        response=client.post(url,headers={'Authorization':f'Bearer {token}'},json={'text':texts})
        if response.status_code in (429,500,502,503,504) and attempt<3:
            time.sleep(min(int(response.headers.get('Retry-After','2')) if response.headers.get('Retry-After','2').isdigit() else 2*(attempt+1),30))
            continue
        response.raise_for_status()
        body=response.json()
        vectors=body.get('result',{}).get('data')
        if body.get('success') is not True or not isinstance(vectors,list) or len(vectors)!=len(texts) or any(not isinstance(v,list) or len(v)!=1024 for v in vectors):
            raise ValueError('Cloudflare no devolvió exactamente un vector BGE-M3 de 1024 dimensiones por sección')
        return vectors
    raise RuntimeError('Se agotaron los reintentos de Cloudflare')


def save_cache(cache:dict,path:Path):
    tmp=path.with_suffix('.tmp')
    tmp.write_text(json.dumps(cache,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    tmp.replace(path)


def run(limit:int|None=None,batch_size:int=20,dry_run:bool=False,cache_path:Path=CACHE):
    if batch_size<1 or batch_size>20 or limit is not None and limit<1:
        raise ValueError('batch-size debe ser 1..20 y limit positivo')
    _,rows,_=load_rows()
    cache=json.loads(cache_path.read_text(encoding='utf-8')) if cache_path.exists() else {'model':MODEL,'vectors':{}}
    if cache.get('model')!=MODEL or not isinstance(cache.get('vectors'),dict):
        raise ValueError('La caché utiliza otro modelo o está dañada')
    pending=[r for r in rows if (entry:=cache['vectors'].get(f"{r['song_id']}:{r['section_index']}")) is None or entry.get('hash')!=r['content_hash'] or len(entry.get('vector',[]))!=1024]
    chosen=pending[:limit]
    print(f'{len(rows)} secciones · {len(pending)} sin vector válido · se generarán {len(chosen)}')
    if dry_run:return
    base=os.environ.get('SUPABASE_URL','').rstrip('/')
    key=os.environ.get('SUPABASE_SECRET_KEY','')
    account=os.environ.get('CLOUDFLARE_ACCOUNT_ID','')
    token=os.environ.get('CLOUDFLARE_API_TOKEN','')
    if not all((base,key,account,token)):
        raise RuntimeError('Configura las cuatro credenciales existentes en api/.env')
    with httpx.Client(timeout=90) as client:
        for start in range(0,len(chosen),batch_size):
            chunk=chosen[start:start+batch_size]
            vectors=embed(client,[r['content'] for r in chunk],account,token)
            for row,vector in zip(chunk,vectors):
                cache['vectors'][f"{row['song_id']}:{row['section_index']}"]={'hash':row['content_hash'],'vector':vector}
            save_cache(cache,cache_path)
            print(f'Embeddings guardados: {start+len(chunk)}/{len(chosen)}')
        # Se suben todos los vectores válidos del archivo, incluidos los de ejecuciones anteriores.
        ready=[]
        for row in rows:
            entry=cache['vectors'].get(f"{row['song_id']}:{row['section_index']}")
            if entry and entry.get('hash')==row['content_hash'] and len(entry.get('vector',[]))==1024:
                ready.append({**row,'embedding':entry['vector'],'embedding_hash':entry['hash']})
        for start in range(0,len(ready),batch_size):
            response=client.post(base+'/rest/v1/song_sections',params={'on_conflict':'song_id,section_index'},headers={'apikey':key,'Prefer':'resolution=merge-duplicates,return=minimal'},json=ready[start:start+batch_size])
            response.raise_for_status()
            if start+batch_size>=len(ready) or (start//batch_size)%10==0:
                print(f'Vectores en Supabase: {min(start+batch_size,len(ready))}/{len(ready)}')
    print(f'Listo. Faltan {len(pending)-len(chosen)} secciones por generar.')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--limit',type=int,help='Genera como máximo esta cantidad de secciones pendientes')
    parser.add_argument('--batch-size',type=int,default=20)
    parser.add_argument('--dry-run',action='store_true')
    args=parser.parse_args()
    run(args.limit,args.batch_size,args.dry_run)


if __name__=='__main__':main()
