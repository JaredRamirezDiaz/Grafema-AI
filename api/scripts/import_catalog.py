"""Carga idempotente del catálogo y los 550 embeddings ya calculados.

Desde api/: python -m scripts.import_catalog
"""
import hashlib
import json
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / "api" / ".env")
SONGS = ROOT / "data" / "songs_clean.json"
EMBEDDINGS = ROOT / "data" / "embeddings_bge_m3.json"


def rows_to_import() -> list[dict]:
    songs = json.loads(SONGS.read_text(encoding="utf-8"))["songs"]
    data = json.loads(EMBEDDINGS.read_text(encoding="utf-8"))
    if data.get("model") != "@cf/baai/bge-m3":
        raise ValueError("Modelo distinto del que utiliza la API")
    texts = {song["id"]: f"Título: {song['title']}\nLetra: {song['lyrics']}" for song in songs}
    fingerprint = hashlib.sha256(json.dumps(
        [(song["id"], texts[song["id"]]) for song in songs],
        ensure_ascii=False, separators=(",", ":")
    ).encode("utf-8")).hexdigest()
    if fingerprint != data["fingerprint"] or len(songs) != 550 or set(texts) != set(data["vectors"]):
        raise ValueError("El catálogo no coincide con los embeddings exportados")
    rows = []
    for song in songs:
        vector = data["vectors"][song["id"]]
        if len(vector) != 1024:
            raise ValueError(f"Dimensión incorrecta: {song['id']}")
        rows.append({
            "id": song["id"], "title": song["title"], "artist": song.get("artist"),
            "lyrics": song["lyrics"], "embedding": vector,
        })
    return rows


def main() -> None:
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SECRET_KEY", "")
    if not url or not key:
        raise RuntimeError("Configura SUPABASE_URL y SUPABASE_SECRET_KEY en el entorno")
    rows = rows_to_import()
    with httpx.Client(timeout=90) as client:
        for start in range(0, len(rows), 20):
            chunk = rows[start:start+20]
            response = client.post(
                url+"/rest/v1/songs?on_conflict=id",
                headers={"apikey": key,
                         "Prefer": "resolution=merge-duplicates,return=minimal"},
                json=chunk,
            )
            response.raise_for_status()
            print(f"Importados {min(start+20,len(rows))}/{len(rows)}")
    print("Catálogo listo: 550 cantos, modelo @cf/baai/bge-m3")


if __name__ == "__main__":
    main()
