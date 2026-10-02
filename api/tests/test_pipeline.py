import json
import os
import tempfile
import unittest
import httpx
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from app.main import app
from scripts import embed_sections,import_labels


class FakeHTTP:
    def __init__(self,*args,**kwargs):
        self.calls=[]
    def __enter__(self):return self
    def __exit__(self,*args):return False
    def get(self,*args,**kwargs):
        class Response:
            def raise_for_status(self):pass
            def json(self):return [{'id':'a'}]
        return Response()
    def post(self,url,**kwargs):
        self.calls.append((url,kwargs))
        class Response:
            def raise_for_status(self):pass
        return Response()


class FakeAsyncHTTP:
    def __init__(self,*args,**kwargs):pass
    async def __aenter__(self):return self
    async def __aexit__(self,*args):return False


class PipelineTests(unittest.TestCase):
    def test_import_upserts_song_and_section_once(self):
        client=FakeHTTP()
        with patch.dict(os.environ,{'SUPABASE_URL':'https://example.supabase.co','SUPABASE_SECRET_KEY':'test'}),\
             patch('scripts.import_labels.load_rows',return_value=([{'song_id':'a'}],[{'song_id':'a','section_index':0}],{'ontology_version':'v1'})),\
             patch('scripts.import_labels.httpx.Client',return_value=client):
            self.assertEqual(import_labels.upload(),(1,1))
        self.assertEqual(len(client.calls),2)
        self.assertEqual(client.calls[1][1]['params']['on_conflict'],'song_id,section_index')

    def test_resume_reuses_vectors_and_uploads_existing_cache(self):
        rows=[{'song_id':'a','section_index':i,'content':f'Verso {i}','content_hash':str(i)} for i in (0,1)]
        generated=[]
        def fake_embed(_,texts,*_args):
            generated.extend(texts)
            return [[.1]*1024 for _ in texts]
        with tempfile.TemporaryDirectory() as folder,\
             patch.dict(os.environ,{'SUPABASE_URL':'https://example.supabase.co','SUPABASE_SECRET_KEY':'test','CLOUDFLARE_ACCOUNT_ID':'x','CLOUDFLARE_API_TOKEN':'test'}),\
             patch('scripts.embed_sections.load_rows',return_value=([],rows,{})),\
             patch('scripts.embed_sections.embed',side_effect=fake_embed),\
             patch('scripts.embed_sections.httpx.Client',return_value=FakeHTTP()):
            path=Path(folder)/'cache.json'
            embed_sections.run(limit=1,cache_path=path)
            embed_sections.run(limit=1,cache_path=path)
            embed_sections.run(limit=1,cache_path=path)
            self.assertEqual(generated,['Verso 0','Verso 1'])
            self.assertEqual(len(json.loads(path.read_text())['vectors']),2)

    def test_enhanced_api_returns_section_and_labels_without_real_network(self):
        songs=[{'id':'a','title':'Título','artist':None,'lyrics':'Letra completa','similarity':.4,'scores':{'temas':{'segunda_venida':.1}}}]
        parts=[{'song_id':'a','title':'Título','artist':None,'lyrics':'Letra completa','section_index':1,'section_order':2,'section_type':'verse','section_text':'Volverá Jesús','similarity':.9,'scores':{'temas':{'segunda_venida':.95},'energia':{'valor':3}},'song_scores':songs[0]['scores']}]
        with patch('app.main.require_settings',return_value={'SUPABASE_URL':'test','SUPABASE_SECRET_KEY':'test','CLOUDFLARE_ACCOUNT_ID':'test','CLOUDFLARE_API_TOKEN':'test'}),\
             patch('app.main.embed_query',new_callable=AsyncMock,return_value=[.1]*1024),\
             patch('app.main.fetch_candidates',new_callable=AsyncMock,return_value=(songs,parts)),\
             patch('app.main.httpx.AsyncClient',FakeAsyncHTTP):
            with TestClient(app) as client:
                response=client.post('/search/enhanced',json={'query':'segunda venida de Cristo','mode':'labels','limit':5})
        self.assertEqual(response.status_code,200,response.text)
        result=response.json()['results'][0]
        self.assertEqual(result['matched_section']['index'],1)
        self.assertEqual(result['match_source'],'section')
        self.assertEqual(result['matched_section']['labels']['temas']['segunda_venida'],.95)

    def test_enhanced_api_logs_the_failing_provider_without_leaking_keys(self):
        config={'SUPABASE_URL':'https://example.supabase.co','SUPABASE_SECRET_KEY':'sb_secret_hidden',
                'CLOUDFLARE_ACCOUNT_ID':'account','CLOUDFLARE_API_TOKEN':'cloudflare_hidden'}
        def respond(request):
            if 'cloudflare.com' in request.url.host:
                return httpx.Response(200,json={'success':True,'result':{'data':[[0.1]*1024]}})
            return httpx.Response(404,json={'code':'PGRST202','message':'No se encontró search_songs_labeled con sb_secret_hidden'})
        original_client=httpx.AsyncClient
        with patch('app.main.require_settings',return_value=config),\
             patch('app.main.httpx.AsyncClient',side_effect=lambda **kwargs: original_client(transport=httpx.MockTransport(respond),**kwargs)),\
             self.assertLogs('uvicorn.error',level='INFO') as captured:
            with TestClient(app) as client:
                response=client.post('/search/enhanced',json={'query':'segunda venida de Cristo'})
        self.assertEqual(response.status_code,502)
        detail=response.json()['detail']
        self.assertEqual(detail['stage'],'supabase_search_songs_labeled')
        self.assertEqual(detail['upstream_status'],404)
        self.assertIn('PGRST202',detail['provider_detail'])
        self.assertNotIn('sb_secret_hidden',detail['provider_detail'])
        self.assertEqual(len(detail['trace_id']),8)
        logs='\n'.join(captured.output)
        self.assertIn('stage=supabase_search_songs_labeled upstream_status=404',logs)
        self.assertIn('PGRST202',logs)
        self.assertNotIn('sb_secret_hidden',logs)
        self.assertNotIn('cloudflare_hidden',logs)

if __name__=='__main__':unittest.main()
