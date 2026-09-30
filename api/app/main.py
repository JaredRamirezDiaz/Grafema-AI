"""API de la demo pública; secretos exclusivos del servidor."""
import os
import logging
from uuid import uuid4
from typing import Literal
from urllib.parse import quote

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.recommendation import make_messages, parse_recommendations
from app.retrieval import rank_songs
from app.search_service import embed_query, fetch_candidates, post_logged

load_dotenv()
MODEL = "@cf/baai/bge-m3"
LLAMA_MODEL = "@cf/meta/llama-3.2-3b-instruct"
app = FastAPI(title="Grafema AI", version="0.2.0")
logger = logging.getLogger('uvicorn.error')
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if origin.strip()],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class SearchRequest(BaseModel):
    query: str = Field(min_length=3, max_length=240)
    limit: int = Field(default=8, ge=1, le=20)


class EnhancedSearchRequest(SearchRequest):
    mode: Literal['song','combined','labels'] = 'labels'


class MatchedSection(BaseModel):
    index: int
    order: int
    type: str
    text: str
    similarity: float
    labels: dict | None = None


class SongResult(BaseModel):
    id: str
    title: str
    artist: str | None = None
    excerpt: str
    lyrics: str
    score: float
    match_source: str | None = None
    matched_section: MatchedSection | None = None
    labels: dict | None = None
    match_labels: dict | None = None
    tag_fit: float | None = None


class SearchResponse(BaseModel):
    query: str
    model: str
    results: list[SongResult]


class EnhancedSearchResponse(SearchResponse):
    mode: str
    intent: dict


class RecommendRequest(BaseModel):
    query: str = Field(min_length=3, max_length=240)
    count: int = Field(default=3, ge=1, le=3)


class Recommendation(BaseModel):
    song: SongResult
    reason: str


class RecommendResponse(BaseModel):
    query: str
    retrieval_model: str
    generation_model: str
    recommendations: list[Recommendation]


def require_settings(require_llama: bool = False) -> dict[str, str]:
    names = ("SUPABASE_URL", "SUPABASE_SECRET_KEY")
    if require_llama:
        names += ("CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN")
    missing = [name for name in names if not os.getenv(name)]
    if missing:
        raise HTTPException(503, detail="La API aún no tiene configurados todos los servicios.")
    return {name: os.getenv(name, '') for name in (*names, 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN',
        'EMBEDDING_REMOTE_URL', 'EMBEDDING_REMOTE_MODEL', 'EMBEDDING_REMOTE_API_KEY')}


def format_results(rows: list[dict]) -> list[SongResult]:
    return [SongResult(
        id=row["id"], title=row["title"], artist=row.get("artist"),
        lyrics=row["lyrics"], excerpt=row["lyrics"].replace("\n", " ").strip()[:185],
        score=round(float(row["similarity"]), 4),
    ) for row in rows]


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/search", response_model=SearchResponse)
async def search(payload: SearchRequest) -> SearchResponse:
    query = " ".join(payload.query.split())
    if len(query) < 3:
        raise HTTPException(422, detail="Escribe una búsqueda de al menos tres caracteres.")
    config = require_settings()
    trace_id = uuid4().hex[:8]
    logger.info('search trace=%s stage=request mode=song limit=%d query_chars=%d',trace_id,payload.limit,len(query))
    database_url = config["SUPABASE_URL"].rstrip("/") + "/rest/v1/rpc/search_songs"
    try:
        async with httpx.AsyncClient(timeout=35) as client:
            vector = await embed_query(client,config,query,trace_id=trace_id)
            matches_response = await post_logged(client,'supabase_search_songs',database_url,config,trace_id,
                headers={
                    "apikey": config["SUPABASE_SECRET_KEY"],
                },
                json={"query_embedding": vector, "match_count": payload.limit},
            )
            rows = matches_response.json()
            if not isinstance(rows, list):
                raise ValueError("Supabase no devolvió una lista de cantos")
            logger.info('search trace=%s stage=results count=%d',trace_id,len(rows))
            return SearchResponse(query=query, model=MODEL, results=format_results(rows))
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        logger.error('search trace=%s stage=song_failure error_type=%s',trace_id,type(exc).__name__)
        # La respuesta pública nunca incluye tokens, URLs privadas o el cuerpo de errores upstream.
        raise HTTPException(502, detail="No se pudo completar la búsqueda. Intenta de nuevo.") from exc


@app.post('/search/enhanced', response_model=EnhancedSearchResponse)
async def search_enhanced(payload:EnhancedSearchRequest) -> EnhancedSearchResponse:
    query=' '.join(payload.query.split())
    if len(query)<3:
        raise HTTPException(422,detail='Escribe una búsqueda de al menos tres caracteres.')
    config=require_settings()
    trace_id=uuid4().hex[:8]
    logger.info('search trace=%s stage=request mode=%s limit=%d query_chars=%d',
                trace_id,payload.mode,payload.limit,len(query))
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            vector=await embed_query(client,config,query,trace_id=trace_id)
            songs,sections=await fetch_candidates(client,config,vector,trace_id=trace_id)
        logger.info('search trace=%s stage=ranking start songs=%d sections=%d',trace_id,len(songs),len(sections))
        rows,intent=rank_songs(songs,sections,query,payload.mode,payload.limit)
        logger.info('search trace=%s stage=ranking results=%d',trace_id,len(rows))
        return EnhancedSearchResponse(query=query,model=MODEL,mode=payload.mode,intent=intent,
            results=[SongResult(**{**row,'excerpt':(row['matched_section']['text'] if row['matched_section'] else row['lyrics']).replace('\n',' ').strip()[:185]}) for row in rows])
    except (httpx.HTTPError,ValueError,KeyError,TypeError) as exc:
        logger.error('search trace=%s stage=enhanced_failure error_type=%s',trace_id,type(exc).__name__)
        raise HTTPException(502,detail='No se pudo completar la búsqueda ampliada. Comprueba que ejecutaste la migración y cargaste las etiquetas.') from exc


@app.post("/recommend", response_model=RecommendResponse)
async def recommend(payload: RecommendRequest) -> RecommendResponse:
    # Usa canciones y secciones con etiquetas para dar evidencia concreta a Llama.
    retrieved = await search_enhanced(EnhancedSearchRequest(query=payload.query,limit=8,mode='labels'))
    songs = retrieved.results
    if not songs:
        return RecommendResponse(query=retrieved.query, retrieval_model=MODEL,
                                 generation_model=LLAMA_MODEL, recommendations=[])
    allowed = {song.id: song for song in songs}
    config = require_settings(require_llama=True)
    account = quote(config["CLOUDFLARE_ACCOUNT_ID"], safe="")
    url = f"https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/{LLAMA_MODEL}"
    messages = make_messages(retrieved.query, [song.model_dump() for song in songs], payload.count)
    try:
        async with httpx.AsyncClient(timeout=75) as client:
            response = await client.post(
                url, headers={"Authorization": f"Bearer {config['CLOUDFLARE_API_TOKEN']}"},
                json={"messages": messages, "max_tokens": 800, "temperature": 0.2},
            )
            response.raise_for_status()
            body = response.json()
            if body.get("success") is not True:
                raise ValueError("Cloudflare rechazó la solicitud")
            choices = parse_recommendations(body.get("result", {}).get("response"), set(allowed), payload.count)
            return RecommendResponse(
                query=retrieved.query, retrieval_model=MODEL, generation_model=LLAMA_MODEL,
                recommendations=[Recommendation(song=allowed[item["id"]], reason=item["reason"])
                                 for item in choices],
            )
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        raise HTTPException(502, detail="Llama no devolvió recomendaciones válidas. Intenta de nuevo.") from exc
