"""Sube las etiquetas ya generadas a Supabase (sin consumir Jev ni embeddings).

Desde api/: python -m scripts.import_labels [--file ../data/songs_labeled.json] [--dry-run]
Primero ejecutar sql/002_labels_and_sections.sql en SQL Editor.
"""
import argparse
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv
from scripts.label_data import LABELS,ROOT,load_rows

load_dotenv(ROOT/'api'/'.env')


def upload(source:Path=LABELS, dry_run:bool=False) -> tuple[int,int]:
    song_rows,section_rows,meta=load_rows(source)
    print(f"Validados {len(song_rows)} cantos y {len(section_rows)} secciones · ontología {meta['ontology_version']}")
    if dry_run:
        return len(song_rows),len(section_rows)
    base=os.environ.get('SUPABASE_URL','').rstrip('/')
    key=os.environ.get('SUPABASE_SECRET_KEY','')
    if not base or not key:
        raise RuntimeError('Configura SUPABASE_URL y SUPABASE_SECRET_KEY en api/.env')
    headers={'apikey':key,'Prefer':'resolution=merge-duplicates,return=minimal'}
    with httpx.Client(timeout=90) as client:
        response=client.get(base+'/rest/v1/songs',params={'select':'id','limit':1000},headers={'apikey':key})
        response.raise_for_status()
        existing={row['id'] for row in response.json()}
        missing={r['song_id'] for r in song_rows}-existing
        if missing:
            raise ValueError(f'Faltan {len(missing)} cantos en Supabase. Ejecuta primero python -m scripts.import_catalog.')
        for name,rows,conflict in [('song_labels',song_rows,'song_id'),('song_sections',section_rows,'song_id,section_index')]:
            for start in range(0,len(rows),20):
                response=client.post(base+f'/rest/v1/{name}',params={'on_conflict':conflict},headers=headers,json=rows[start:start+20])
                response.raise_for_status()
                if (start//20)%10==0 or start+20>=len(rows):
                    print(f'{name}: {min(start+20,len(rows))}/{len(rows)}')
    return len(song_rows),len(section_rows)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--file',type=Path,default=LABELS)
    parser.add_argument('--dry-run',action='store_true')
    args=parser.parse_args()
    upload(args.file,args.dry_run)


if __name__=='__main__':main()
