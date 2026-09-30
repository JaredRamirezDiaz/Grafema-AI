import asyncio
import json
import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx

from app.embedding_service import _encode_local, _load_local, checked_vector, embed_with_fallback, provider_order
from app.main import require_settings
from app.search_service import post_logged
from fastapi.testclient import TestClient
from app.main import app


class ProviderTests(unittest.TestCase):
    def test_local_model_uses_selected_gpu_and_reuses_the_model(self):
        created = []

        class Dense:
            def tolist(self): return [0.1]*1024

        class FakeModel:
            def __init__(self, name, **kwargs):
                created.append((name, kwargs))
            def encode(self, texts, **kwargs):
                self.last_texts = texts
                return {'dense_vecs': [Dense()]}

        _load_local.cache_clear()
        with patch.dict(sys.modules, {'FlagEmbedding': SimpleNamespace(BGEM3FlagModel=FakeModel)}), \
             patch('app.embedding_service._device', return_value='cuda:0'):
            self.assertEqual(len(_encode_local('alabanza')), 1024)
            self.assertEqual(len(_encode_local('gratitud')), 1024)
        _load_local.cache_clear()
        self.assertEqual(len(created), 1)
        self.assertEqual(created[0], ('BAAI/bge-m3', {'devices': 'cuda:0', 'use_fp16': True}))

    def test_local_only_does_not_require_cloudflare_credentials(self):
        with patch.dict(os.environ, {'SUPABASE_URL': 'https://example.supabase.co',
                                  'SUPABASE_SECRET_KEY': 'test', 'EMBEDDING_PROVIDERS': 'local'}, clear=True):
            self.assertEqual(provider_order(), ['local'])
            self.assertEqual(require_settings()['SUPABASE_SECRET_KEY'], 'test')

    def test_cloudflare_429_uses_local_fallback(self):
        def respond(request):
            return httpx.Response(429, json={'errors': [{'code': 4006, 'message': 'daily quota exhausted'}]})

        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
                return await embed_with_fallback(client, {'CLOUDFLARE_ACCOUNT_ID': 'account',
                    'CLOUDFLARE_API_TOKEN': 'secret'}, 'esperanza', 'testing', post_logged)

        with patch.dict(os.environ, {'EMBEDDING_PROVIDERS': 'cloudflare,local'}), \
             patch('app.embedding_service.asyncio.to_thread', new_callable=AsyncMock, return_value=[0.1]*1024) as local, \
             self.assertLogs('uvicorn.error', level='INFO') as logs:
            result = asyncio.run(run())
        self.assertEqual(len(result), 1024)
        local.assert_awaited_once()
        output = '\n'.join(logs.output)
        self.assertIn('upstream_status=429', output)
        self.assertIn('fallback=local', output)
        self.assertNotIn('secret', output)

    def test_remote_must_return_bge_m3_vector(self):
        def respond(request):
            self.assertEqual(json.loads(request.content)['model'], 'BAAI/bge-m3')
            return httpx.Response(200, json={'data': [{'embedding': [0.2]*1024}]})

        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
                return await embed_with_fallback(client, {'EMBEDDING_REMOTE_URL': 'https://example.com/v1/embeddings'},
                                                 'esperanza', 'testing', post_logged)

        with patch.dict(os.environ, {'EMBEDDING_PROVIDERS': 'remote'}):
            self.assertEqual(len(asyncio.run(run())), 1024)
        with self.assertRaises(ValueError):
            checked_vector([0.1]*768, 'remote')

    def test_invalid_provider_list_fails_before_network(self):
        with patch.dict(os.environ, {'EMBEDDING_PROVIDERS': 'other,cloudflare'}):
            with self.assertRaises(ValueError):
                provider_order()

    def test_both_search_endpoints_work_with_only_local_provider(self):
        def respond(request):
            self.assertEqual(request.url.host, 'example.supabase.co')
            if request.url.path.endswith('search_song_sections'):
                return httpx.Response(200, json=[])
            return httpx.Response(200, json=[{
                'id': 'song-1', 'title': 'Gratitud', 'artist': None,
                'lyrics': 'Gracias a Dios', 'similarity': 0.9, 'scores': None,
            }])

        original_client = httpx.AsyncClient
        with patch.dict(os.environ, {'SUPABASE_URL': 'https://example.supabase.co',
                                   'SUPABASE_SECRET_KEY': 'test', 'EMBEDDING_PROVIDERS': 'local'}, clear=True), \
             patch('app.embedding_service.asyncio.to_thread', new_callable=AsyncMock, return_value=[0.1]*1024), \
             patch('app.main.httpx.AsyncClient', side_effect=lambda **kwargs: original_client(
                 transport=httpx.MockTransport(respond), **kwargs)):
            with TestClient(app) as client:
                for route in ('/search', '/search/enhanced'):
                    response = client.post(route, json={'query': 'Gracias a Dios'})
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assertEqual(response.json()['results'][0]['id'], 'song-1')


if __name__ == '__main__':
    unittest.main()
