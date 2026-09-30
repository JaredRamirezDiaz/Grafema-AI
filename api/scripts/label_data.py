"""Valida la exportación de Jev contra el catálogo que ya está en Supabase."""
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CATALOG = ROOT / 'data' / 'songs_clean.json'
LABELS = ROOT / 'data' / 'songs_labeled.json'
GROUPS = ('temas', 'caracter', 'momento', 'enfoque')


def section_text(title: str, section: dict) -> str:
    return (f"Título: {title}\nTipo: {section['type']}\n"
            f"Sección {section['order']}\nLetra: {' '.join(section['lines'])}")


def digest(text: str) -> str:
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def valid_scores(scores: object, place: str) -> None:
    if not isinstance(scores, dict) or not all(isinstance(scores.get(g), dict) and scores[g] for g in GROUPS):
        raise ValueError(f'{place}: faltan grupos de etiquetas')
    for group in GROUPS:
        for name, number in scores[group].items():
            if not isinstance(number, (float,int)) or isinstance(number,bool) or not math.isfinite(number) or not 0 <= number <= 1:
                raise ValueError(f'{place}: puntaje inválido {group}.{name}')
    energy = scores.get('energia')
    if not isinstance(energy,dict) or not isinstance(energy.get('valor'),(float,int)) or not math.isfinite(energy['valor']) or not 1 <= energy['valor'] <= 5:
        raise ValueError(f'{place}: energía inválida')
    levels = energy.get('niveles')
    if not isinstance(levels,dict) or set(levels) != {'1','2','3','4','5'} or any(not isinstance(v,(float,int)) or not math.isfinite(v) or not 0 <= v <= 1 for v in levels.values()):
        raise ValueError(f'{place}: niveles de energía inválidos')


def load_rows(source: Path = LABELS) -> tuple[list[dict], list[dict], dict]:
    catalog = json.loads(CATALOG.read_text(encoding='utf-8'))['songs']
    exported = json.loads(source.read_text(encoding='utf-8'))
    songs = exported.get('songs')
    if not isinstance(songs,list) or not exported.get('ontology_version') or not exported.get('model') or not exported.get('provider'):
        raise ValueError('Exportación songs_labeled.json incompleta')
    by_id = {song['id']:song for song in catalog}
    if len(by_id)!=len(catalog) or len(songs)!=len(catalog) or {song['id'] for song in songs}!=set(by_id):
        raise ValueError('Los IDs de songs_labeled no corresponden a songs_clean')
    meta = {k:exported[k] for k in ('ontology_version','provider','model')}
    song_rows=[]; section_rows=[]
    for item in songs:
        original=by_id[item['id']]
        if item['title'] != original['title'] or len(item.get('sections',[])) != len(original['sections']):
            raise ValueError(f"Catálogo diferente: {item['id']}")
        valid_scores(item.get('song'),f"canto {item['id']}")
        song_rows.append({'song_id':item['id'],'scores':item['song'],**meta})
        indexes=set()
        for sec in item['sections']:
            idx=sec.get('index')
            if not isinstance(idx,int) or idx<0 or idx>=len(original['sections']) or idx in indexes:
                raise ValueError(f"Índice de sección inválido: {item['id']} {idx}")
            indexes.add(idx)
            ref=original['sections'][idx]
            if (sec['type'],sec['order'],sec['lines']) != (ref['type'],ref['order'],ref['lines']):
                raise ValueError(f"La sección cambió respecto a songs_clean: {item['id']}:{idx}")
            valid_scores(sec.get('scores'),f"sección {item['id']}:{idx}")
            text=section_text(item['title'],sec)
            section_rows.append({'song_id':item['id'],'section_index':idx,
                                 'section_order':sec['order'],'section_type':sec['type'],
                                 'lines':sec['lines'],'content':text,'content_hash':digest(text),
                                 'scores':sec['scores'],**meta})
        if indexes!=set(range(len(original['sections']))):
            raise ValueError(f"Secciones incompletas: {item['id']}")
    return song_rows,section_rows,meta
