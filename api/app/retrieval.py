"""Fusión explicable de canciones, secciones y etiquetas. Sin llamadas de red."""
import re
import unicodedata

ALIASES = {
    'temas': {
        'alabanza':['alabanza','alabanzas'],
        'adoracion':['adoracion','adorar'],
        'gracia':['gracia'], 'perdon':['perdon','arrepentimiento','contricion'],
        'salvacion':['salvacion','redencion'], 'cruz':['cruz','crucificado','sangre de jesus'],
        'resurreccion':['resurreccion','resucito','resucitado'],
        'segunda_venida':['segunda venida','regreso de cristo','venida del senor'],
        'espiritu_santo':['espiritu santo'], 'dios_padre':['dios padre','padre celestial'],
        'fe':['fe','confiar','confianza'], 'esperanza':['esperanza'],
        'amor_de_dios':['amor de dios'], 'amor_fraternal':['amor fraternal'],
        'oracion':['oracion','orar'], 'gratitud':['gratitud','agradecimiento','gracias a dios'],
        'entrega':['entrega','consagracion','dedicar la vida'],
        'servicio':['servir','obra de dios'], 'evangelismo':['evangelismo','predicar el evangelio'],
        'iglesia':['iglesia','congregacion'], 'palabra_de_dios':['biblia','palabra de dios','escritura'],
        'mision':['mision','misiones','discipulos'],
        'prueba_y_dificultad':['dificultad','prueba','sufrimiento'],
        'victoria':['victoria'], 'eternidad':['eternidad','cielo','patria celestial'],
    },
    'caracter': {
        'celebrativo':['celebrativo'], 'contemplativo':['contemplativo'],
        'solemne':['solemne'], 'reflexivo':['reflexivo'], 'gozoso':['gozoso','gozo','alegria'],
        'intimo':['intimo'], 'triunfal':['triunfal'],
    },
    'momento': {
        'apertura':['apertura','iniciar el servicio','inicio del servicio','abrir el servicio'],
        'reflexion':['momento de reflexion'], 'respuesta':['momento de respuesta'],
        'ofrenda':['ofrenda'], 'comunion':['comunion','santa cena'],
        'llamado':['llamado','llamamiento'], 'cierre':['cierre','terminar el servicio'],
    },
    'enfoque': {
        'vertical':['dirigido a dios','hablarle a dios'],
        'congregacional':['congregacional'], 'testimonial':['testimonio','testimonial'],
        'evangelistico':['evangelistico'], 'doctrinal':['doctrinal'],
    },
}


def normalize(text:str) -> str:
    return re.sub(r'\s+',' ',''.join(c for c in unicodedata.normalize('NFD',text.lower()) if unicodedata.category(c)!='Mn'))


def infer_intent(query:str) -> dict:
    clean=normalize(query)
    labels={}
    for group,options in ALIASES.items():
        found=[key for key,phrases in options.items() if any(re.search(r'(?<!\w)'+re.escape(p)+r'(?!\w)',clean) for p in phrases)]
        if found: labels[group]=found
    energy=None
    if re.search(r'energia (baja|tranquila|suave)|cantos? (suaves?|tranquilos?)',clean):energy=2
    elif re.search(r'energia (alta|fuerte)|cantos? (energeticos?|fuertes?)',clean):energy=5
    return {'labels':labels,'energy':energy}


def tag_fit(scores:dict|None,intent:dict) -> float|None:
    if not isinstance(scores,dict):return None
    matched=[]
    for group,keys in intent['labels'].items():
        values=scores.get(group) or {}
        matched += [float(values[k]) for k in keys if isinstance(values.get(k),(int,float))]
    energy=intent['energy']
    if energy is not None:
        value=(scores.get('energia') or {}).get('valor')
        if isinstance(value,(int,float)):
            matched.append(max(0,1-abs(value-energy)/4))
    return sum(matched)/len(matched) if matched else None


def rank_songs(song_rows:list[dict],section_rows:list[dict],query:str,mode:str='labels',limit:int=8) -> tuple[list[dict],dict]:
    if mode not in ('song','section','combined','labels'):raise ValueError('Modo desconocido')
    intent=infer_intent(query)
    by_id={}
    for row in song_rows:
        by_id[row['id']]={'song':row,'parts':[]}
    if mode!='song':
        for row in section_rows:
            entry=by_id.setdefault(row['song_id'],{'song':None,'parts':[]})
            entry['parts'].append(row)
    output=[]
    for song_id,entry in by_id.items():
        song=entry['song'];parts=entry['parts']
        if mode=='section' and not parts:continue
        if song is None:
            if not parts:continue
            ref=parts[0]
            song={'id':song_id,'title':ref['title'],'artist':ref.get('artist'),'lyrics':ref['lyrics'],'scores':ref.get('song_scores'),'similarity':-1}
        choices=[]
        if mode!='section' and entry['song']:
            choices.append((float(song['similarity']),None,song.get('scores')))
        for part in parts:
            choices.append((float(part['similarity']),part,part.get('scores')))
        scored=[]
        for similarity,part,scores in choices:
            fit=tag_fit(scores,intent) if mode=='labels' else None
            value=0.85*max(0,similarity)+0.15*fit if fit is not None else similarity
            scored.append((value,similarity,part,scores,fit))
        if not scored:continue
        score,similarity,part,scope_scores,fit=max(scored,key=lambda x:x[0])
        output.append({'id':song_id,'title':song['title'],'artist':song.get('artist'),
                       'lyrics':song['lyrics'],'score':round(score,4),
                       'match_source':'section' if part else 'song',
                       'matched_section':({'index':part['section_index'],'order':part['section_order'],
                                           'type':part['section_type'],'text':part['section_text'],
                                           'similarity':round(float(part['similarity']),4),
                                           'labels':part.get('scores')} if part else None),
                       'labels':song.get('scores'),'match_labels':scope_scores,
                       'tag_fit':round(fit,4) if fit is not None else None})
    output.sort(key=lambda r:(-r['score'],-(r['tag_fit'] or 0),r['id']))
    return output[:limit],intent
