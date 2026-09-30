"""Compara los tres métodos con las mismas 23 consultas y 332 cantos del PDF.

Desde api/: python -m scripts.evaluate_labels
Requiere que los 2.040 embeddings de sección estén subidos a Supabase.
"""
import asyncio
import json
import os
from datetime import datetime,timezone

import httpx
from dotenv import load_dotenv
from app.retrieval import rank_songs
from app.search_service import MODEL,embed_query,fetch_candidates
from scripts.label_data import ROOT,load_rows

load_dotenv(ROOT/'api'/'.env')
GOLD=ROOT/'data'/'benchmark_tematico_pdf.json'
OUTPUT=ROOT/'data'/'evaluacion_secciones_etiquetas.json'


def metrics(queries:list[dict]):
    return {'meanHitAt5':round(sum(q['hitAt5'] for q in queries)/len(queries),4),
            'meanListedRecallAt10':round(sum(q['recallOfListedPositivesAt10'] for q in queries)/len(queries),4)}


async def run():
    config={key:os.environ.get(key,'') for key in ('SUPABASE_URL','SUPABASE_SECRET_KEY','CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_API_TOKEN')}
    if not all(config.values()):raise RuntimeError('Faltan credenciales en api/.env')
    document=json.loads(GOLD.read_text(encoding='utf-8'))
    category_by_id={c['id']:c for c in document['categories']}
    eligible=sorted({s['songId'] for c in document['categories'] for s in c['songs']})
    _,sections,meta=load_rows()
    expected=len(sections)
    async with httpx.AsyncClient(timeout=60) as client:
        # Supabase puede limitar cada respuesta REST a 1.000 filas.
        rows=[]
        for start in range(0,expected+1,1000):
            response=await client.get(config['SUPABASE_URL'].rstrip('/')+'/rest/v1/song_sections',
                params={'select':'song_id,section_index,content_hash,embedding_hash',
                        'order':'song_id.asc,section_index.asc'},
                headers={'apikey':config['SUPABASE_SECRET_KEY'],'Range':f'{start}-{start+999}'})
            response.raise_for_status()
            page=response.json()
            if not isinstance(page,list):raise ValueError('Supabase no devolvió una página de secciones')
            rows.extend(page)
            if len(page)<1000:break
        if len(rows)!=expected or any(row['embedding_hash']!=row['content_hash'] for row in rows):
            raise RuntimeError(f'Se necesitan {expected} embeddings vigentes para comparar: hay {sum(row["embedding_hash"]==row["content_hash"] for row in rows)} de {len(rows)} secciones.')
        report={mode:[] for mode in ('song','combined','labels')}
        for q in document['queries']:
            vector=await embed_query(client,config,q['query'])
            songs,parts=await fetch_candidates(client,config,vector,eligible_ids=eligible)
            positives={s['songId'] for s in category_by_id[q['categoryId']]['songs']}
            for mode in report:
                ranked,intent=rank_songs(songs,parts,q['query'],mode,10)
                top=[r['id'] for r in ranked]
                report[mode].append({'queryId':q['id'],'query':q['query'],'categoryId':q['categoryId'],
                    'positivesInPdf':len(positives),'hitAt5':int(bool(positives.intersection(top[:5]))),
                    'recallOfListedPositivesAt10':round(len(positives.intersection(top[:10]))/len(positives),4),
                    'intent':intent,'top10':[{'songId':r['id'],'title':r['title'],'score':r['score'],
                        'matchSource':r['match_source'],'sectionIndex':r['matched_section']['index'] if r['matched_section'] else None,
                        'listedInCategory':r['id'] in positives} for r in ranked]})
            print(f"{q['id']} / {len(document['queries'])}: {q['query']}")
    result={'sourceBenchmark':'benchmark_tematico_pdf.json','evaluationScope':'332 cantos enumerados por el PDF',
            'runAt':datetime.now(timezone.utc).isoformat(),'model':MODEL,'ontologyVersion':meta['ontology_version'],
            'provider':meta['provider'],'sectionEmbeddings':expected,
            'note':'Positivos documentados, no negativos. Las etiquetas automáticas son independientes del PDF. Solo se evalúan 332 cantos.',
            'methods':{mode:{**metrics(qs),'queries':qs} for mode,qs in report.items()}}
    OUTPUT.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    for mode,data in result['methods'].items():
        print(f"{mode}: hit@5={data['meanHitAt5']:.3f}, recall listado@10={data['meanListedRecallAt10']:.3f}")
    print(f'Resultado: {OUTPUT}')


if __name__=='__main__':asyncio.run(run())
