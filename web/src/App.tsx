import { FormEvent, useState } from 'react'

type Scores = {temas?:Record<string,number>;caracter?:Record<string,number>;momento?:Record<string,number>;enfoque?:Record<string,number>;energia?:{valor:number}}
type MatchedSection = {index:number;order:number;type:string;text:string;similarity:number;labels:Scores|null}
type Song = { id: string; title: string; artist: string | null; excerpt: string; lyrics: string; score: number; match_source?:string; matched_section?:MatchedSection|null; labels?:Scores|null; match_labels?:Scores|null }
type SearchResponse = { query: string; model: string; results: Song[]; mode:string; intent:{labels:Record<string,string[]>;energy:number|null} }
type Recommendation = { song: Song; reason: string }
type RecommendResponse = { query: string; retrieval_model: string; generation_model: string; recommendations: Recommendation[] }
const examples = [
  'Cantos sobre la esperanza en medio de las dificultades',
  'Himnos de gratitud para iniciar el servicio',
  'Cantos que anuncien la resurrección de Jesús',
]
const apiBase = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')
const modes = {song:'Canción completa',combined:'Canción y secciones',labels:'Canción, secciones y etiquetas'} as const
type Mode = keyof typeof modes
const pretty = (value:string) => value.replaceAll('_',' ').replace(/^\w/,character=>character.toUpperCase())
function topTags(scores:Scores|null|undefined, group:keyof Omit<Scores,'energia'>, count=3) {
  return Object.entries(scores?.[group]||{}).filter(([,score])=>score>=.65).sort((a,b)=>b[1]-a[1]).slice(0,count)
}

function App() {
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [songs, setSongs] = useState<Song[]>([])
  const [selected, setSelected] = useState<Song | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [recommendations, setRecommendations] = useState<Recommendation[] | null>(null)
  const [recommendLoading, setRecommendLoading] = useState(false)
  const [recommendError, setRecommendError] = useState('')
  const [mode,setMode] = useState<Mode>('labels')
  const [submittedMode,setSubmittedMode] = useState<Mode>('labels')
  const [intent,setIntent] = useState<SearchResponse['intent']|null>(null)

  async function search(text: string) {
    const clean = text.trim()
    if (clean.length < 3 || loading) return
    setQuery(clean)
    setLoading(true)
    setError('')
    setSelected(null)
    setRecommendations(null)
    setRecommendError('')
    try {
      const response = await fetch(`${apiBase}/search/enhanced`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: clean, limit: 8, mode }),
      })
      if (!response.ok) throw new Error(`La API respondió con ${response.status}. Comprueba la configuración e inténtalo de nuevo.`)
      const data = await response.json() as SearchResponse
      setSongs(data.results)
      setSubmitted(data.query)
      setSubmittedMode(mode)
      setIntent(data.intent)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Ocurrió un error inesperado.')
    } finally {
      setLoading(false)
    }
  }

  async function recommend() {
    if (!submitted || recommendLoading) return
    setRecommendLoading(true)
    setRecommendError('')
    try {
      const response = await fetch(`${apiBase}/recommend`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: submitted, count: 3 }),
      })
      if (!response.ok) throw new Error(`La recomendación no está disponible (${response.status}). Intenta de nuevo.`)
      const data = await response.json() as RecommendResponse
      setRecommendations(data.recommendations)
    } catch (reason) {
      setRecommendError(reason instanceof Error ? reason.message : 'No pudimos generar recomendaciones.')
    } finally {
      setRecommendLoading(false)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void search(query)
  }

  return <>
    <header className="topbar"><a className="wordmark" href="/">GRAFEMA <b>AI</b></a><nav><a href="/agente.html">Crear servicio ↗</a> · <a href="/benchmark.html">Ver benchmark ↗</a></nav></header>
    <main>
      <section className="hero">
        <div className="glow" aria-hidden="true" />
        <div className="hero-content">
          <span className="eyebrow"><span className="status-dot" /> PROYECTO DEL DIPLOMADO · DEMO PÚBLICA</span>
          <h1>Encuentra el canto<br /><em>que estás buscando.</em></h1>
          <p>Describe un tema, una emoción o un momento del servicio. La búsqueda encuentra cantos por el significado de sus letras.</p>
          <form onSubmit={submit} className="search-box" role="search">
            <label className="sr-only" htmlFor="q">Describe el canto que necesitas</label>
            <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.6" /><path d="m16 16 5 5" /></svg>
            <input id="q" value={query} onChange={event => setQuery(event.target.value)} maxLength={240} placeholder="Ej. Cantos de esperanza en tiempos difíciles" />
            <button disabled={loading || query.trim().length < 3}>{loading ? 'Buscando…' : 'Buscar cantos'}</button>
          </form>
          <div className="suggestions"><span>Prueba con:</span>{examples.map(example => <button key={example} type="button" onClick={() => void search(example)} disabled={loading}>{example}</button>)}</div>
          <div className="search-modes" role="group" aria-label="Modo de búsqueda">{(Object.entries(modes) as [Mode,string][]).map(([key,label])=><button key={key} type="button" className={mode===key?'active':''} aria-pressed={mode===key} onClick={()=>setMode(key)}>{label}</button>)}</div>
        </div>
      </section>
      <section className="content" aria-live="polite">
        {error && <div className="alert" role="alert"><strong>No pudimos completar la búsqueda.</strong> {error}</div>}
        {!submitted && !loading && !error && <div className="welcome"><span className="welcome-mark">✳</span><h2>Busca como lo dirías normalmente</h2><p>El catálogo ya contiene 550 cantos de Grafema. Puedes explorar los resultados sin registrarte ni cargar archivos.</p><a href="/benchmark.html">Conoce cómo se evaluó la búsqueda →</a></div>}
        {loading && <div className="loading" role="status">Buscando cantos relacionados con tu solicitud…</div>}
        {submitted && !loading && <>
          <div className="results-heading"><div><span className="section-kicker">RESULTADOS · {modes[submittedMode]}</span><h2>Encontramos {songs.length} cantos</h2><p>Para «{submitted}»{intent && Object.values(intent.labels).flat().length>0 && submittedMode==='labels'?` · etiquetas detectadas: ${Object.values(intent.labels).flat().map(pretty).join(', ')}`:''}</p></div><span className="model-badge">BGE-M3</span></div>
          {!!songs.length && <section className="recommend-panel" aria-label="Selección de cantos con Llama">
            <div className="recommend-top"><div><span className="section-kicker">SEGUNDO PASO · LLAMA 3.2</span><h3>Una selección para tu servicio</h3><p>Llama revisa los ocho cantos recuperados y propone hasta tres con una explicación.</p></div><button type="button" onClick={() => void recommend()} disabled={recommendLoading}>{recommendLoading ? 'Preparando selección…' : recommendations ? 'Generar otra vez' : 'Sugerir cantos'}</button></div>
            {recommendError && <p className="recommend-error" role="alert">{recommendError}</p>}
            {recommendations && (recommendations.length ? <div className="recommend-list">{recommendations.map(({song, reason}, index) => <button type="button" key={song.id} onClick={() => setSelected(song)}><span className="recommend-number">{index + 1}</span><span><strong>{song.title}</strong><small>{reason}</small><em>Ver la letra →</em></span></button>)}</div> : <p>No hubo recomendaciones para esta solicitud.</p>)}
            {recommendations && <p className="recommend-note">Los motivos los genera Llama; verifica la letra del canto antes de usarlo.</p>}
          </section>}
          {!songs.length && <p>No encontramos cantos. Prueba otra descripción.</p>}
          <div className="layout"><div className="cards">{songs.map((song, index) => <button className={`song-card ${selected?.id === song.id ? 'selected' : ''}`} key={song.id} type="button" onClick={() => setSelected(song)} aria-label={`Ver letra de ${song.title}`}><span className="song-number">{String(index + 1).padStart(2, '0')}</span><span className="song-info"><strong>{song.title}</strong><span>{song.artist || 'Canto del catálogo'}</span>{song.matched_section && <span className="matched-type">Coincide: {pretty(song.matched_section.type)} {song.matched_section.order}</span>}<small>{song.excerpt}{song.excerpt.length >= 185 ? '…' : ''}</small><span className="tag-pills">{topTags(song.match_labels,'temas').map(([tag,value])=><span key={tag}>{pretty(tag)} {Math.round(value*100)}%</span>)}{song.match_labels?.energia && <span>Energía {song.match_labels.energia.valor.toFixed(1)}/5</span>}</span></span><span className="arrow" aria-hidden="true">↗</span></button>)}</div>
            <aside className="detail" aria-label="Letra del canto seleccionado">{selected ? <><span className="section-kicker">CANTO SELECCIONADO</span><h3>{selected.title}</h3>{selected.artist && <p className="artist">{selected.artist}</p>}{selected.matched_section && <section className="section-evidence"><strong>{pretty(selected.matched_section.type)} {selected.matched_section.order} · sección coincidente</strong><p>{selected.matched_section.text}</p><div className="tag-pills">{(['temas','caracter','momento','enfoque'] as const).flatMap(group=>topTags(selected.matched_section?.labels,group,2).map(([tag,value])=><span key={`${group}:${tag}`}>{pretty(tag)} {Math.round(value*100)}%</span>))}{selected.matched_section.labels?.energia&&<span>Energía {selected.matched_section.labels.energia.valor.toFixed(1)}/5</span>}</div></section>}<span className="detail-subhead">LETRA COMPLETA</span><div className="lyrics">{selected.lyrics}</div></> : <div className="detail-placeholder"><span>♫</span><h3>Explora la letra</h3><p>Selecciona un canto para leerlo completo.</p></div>}</aside></div>
          <p className="disclaimer">Las etiquetas son probabilidades calculadas sobre la letra. Revisa el canto y la sección antes de elegirlo para un servicio.</p>
        </>}
      </section>
    </main>
    <footer><span>Grafema AI · Proyecto personal para apoyar a mi iglesia</span><a href="/benchmark.html">Metodología y resultados del benchmark</a></footer>
  </>
}

export default App
