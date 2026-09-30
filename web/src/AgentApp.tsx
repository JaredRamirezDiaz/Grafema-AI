import { useEffect, useState, type FormEvent } from 'react'
import './agent.css'
import { recipes, rememberService, savedServices, type Recipe, type Recent } from './agent-shared'

type Scores = { temas?: Record<string, number>; caracter?: Record<string, number>; momento?: Record<string, number>; enfoque?: Record<string, number>; energia?: { valor?: number } }
type Song = { id: string; title: string; excerpt: string; lyrics: string; labels?: Scores | null; match_labels?: Scores | null;
  matched_section?: { type: string; order: number; text: string } | null }
type Slot = { key: string; title: string; targetEnergy: number; query: string }
type Item = { key: string; slot: Slot; song: Song; reason: string; alternatives: Song[] }
type Selection = { key: string; songId: string; reason: string }
type Plan = { theme: string; recipe: Recipe; provider: string; model: string; searches: { slot: string; query: string; count: number }[];
  items: Item[]; missingSlots: string[]; draft: { id: string; editToken: string; status: 'draft' | 'reviewed' } }
type Provider = { id: 'cloudflare' | 'openrouter'; label: string; models: { id: string; label: string }[] }
type Progress = { type: string; slot?: string; query?: string; count?: number; message: string }
const options = (item: Item) => [item.song, ...item.alternatives]

function Evidence({ song, full = false }: { song: Song; full?: boolean }) {
  const scores = song.match_labels || song.labels
  const energy = song.labels?.energia?.valor ?? scores?.energia?.valor
  return <><div className="evidence-tags">{(['temas', 'caracter', 'momento', 'enfoque'] as const).flatMap(group =>
    Object.entries(scores?.[group] || {}).filter(([, value]) => value >= .6).sort((a, b) => b[1] - a[1]).slice(0, full ? 4 : 2)
      .map(([tag, value]) => <span key={`${group}:${tag}`} title={group}>{tag.replaceAll('_', ' ')} {Math.round(value * 100)}%</span>))}
    {typeof energy === 'number' && <span>Energía {energy.toFixed(1)}/5</span>}</div>
    {song.matched_section && full && <div className="evidence-section"><strong>Coincidencia: {song.matched_section.type} {song.matched_section.order}</strong><p>{song.matched_section.text}</p></div>}
    {full && <div className="lyrics">{song.lyrics}</div>}</>
}

async function readEvents(response: Response, onEvent: (name: string, data: unknown) => void) {
  if (!response.ok || !response.body) throw new Error(`El agente respondió ${response.status}. Revisa la configuración.`)
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replaceAll('\r\n', '\n')
    const blocks = buffer.split('\n\n'); buffer = blocks.pop() || ''
    for (const block of blocks) {
      const event = block.split('\n').find(line => line.startsWith('event: '))?.slice(7)
      const data = block.split('\n').find(line => line.startsWith('data: '))?.slice(6)
      if (event && data) onEvent(event, JSON.parse(data))
    }
    if (done) break
  }
}

export default function AgentApp() {
  const [theme, setTheme] = useState('Esperanza en medio de las dificultades')
  const [focus, setFocus] = useState('')
  const [specialOccasion, setSpecialOccasion] = useState('')
  const [recipe, setRecipe] = useState<Recipe>('descendente')
  const [count, setCount] = useState(7)
  const [notes, setNotes] = useState('')
  const [providers, setProviders] = useState<Provider[]>([])
  const [provider, setProvider] = useState<Provider['id']>('cloudflare')
  const [model, setModel] = useState('')
  const [plan, setPlan] = useState<Plan | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [recent, setRecent] = useState<Recent[]>([])
  const [progress, setProgress] = useState<Progress[]>([])
  const [exploreKey, setExploreKey] = useState<string | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [adminToken, setAdminToken] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const batchDraftId = new URLSearchParams(window.location.search).get('draft')

  useEffect(() => {
    setRecent(savedServices())
    let active = true
    fetch('/api/service').then(response => response.json() as Promise<{ providers: Provider[] }>).then(data => {
      if (!active) return
      setProviders(data.providers || [])
      const first = data.providers?.[0]; if (first) { setProvider(first.id); setModel(first.models[0]?.id || '') }
    }).catch(() => { if (active) setError('No se pudo conectar con el servidor del agente.') })
    return () => { active = false }
  }, [])

  function remember(result: Plan) { setRecent(rememberService({ id: result.draft.id, token: result.draft.editToken,
    theme: result.theme, recipe: result.recipe, model: result.model, provider: result.provider })) }

  async function generate(event: FormEvent) {
    event.preventDefault(); if (busy || !model) return
    setBusy(true); setError(''); setMessage(''); setPlan(null); setItems([]); setProgress([])
    let completed = false
    try {
      const response = await fetch('/api/service', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ theme, focus, specialOccasion, recipe, count, notes, provider, model }) })
      await readEvents(response, (name, payload) => {
        if (name === 'status') setProgress(current => [...current, payload as Progress])
        if (name === 'error') throw new Error((payload as { error: string }).error)
        if (name === 'result') { const result = payload as Plan; completed = true; setPlan(result); setItems(result.items); remember(result)
          setMessage('Borrador guardado. Revisa los cantos antes de aprobar el ejemplo.') }
      })
      if (!completed) throw new Error('El agente terminó sin guardar una propuesta.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo crear el servicio.') }
    finally { setBusy(false) }
  }

  async function loadRecent(entry: Recent) {
    setError(''); setMessage('')
    try {
      const response = await fetch(`/api/draft?id=${encodeURIComponent(entry.id)}`, { headers: { 'x-edit-token': entry.token, 'x-dataset-admin-token': adminToken } })
      const data = await response.json() as { error?: string; plan: Plan; request: { theme: string; recipe: Recipe; count: number; notes: string; focus: string; specialOccasion: string }; selections: Selection[]; status: 'draft' | 'reviewed' }
      if (!response.ok) throw new Error(data.error || 'No se pudo recuperar el borrador.')
      setPlan({ ...data.plan, theme: data.request.theme, recipe: data.request.recipe, draft: { id: entry.id, editToken: entry.token, status: data.status } })
      setItems(data.plan.items.map(original => { const selection = data.selections.find(item => item.key === original.key)
        const song = options(original).find(candidate => candidate.id === selection?.songId) || original.song
        return { ...original, song, reason: selection?.reason ?? original.reason, alternatives: options(original).filter(candidate => candidate.id !== song.id) } }))
      setTheme(data.request.theme); setRecipe(data.request.recipe); setCount(data.request.count)
      setNotes(data.request.notes || ''); setFocus(data.request.focus || ''); setSpecialOccasion(data.request.specialOccasion || '')
      if (entry.token) setRecent(current => current.map(saved => saved.id === entry.id ? { ...saved, recipe: data.request.recipe,
        model: data.plan.model, provider: data.plan.provider } : saved))
      setMessage('Borrador recuperado.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo recuperar el borrador.') }
  }

  async function persist(updated: Item[]) {
    if (!plan || saving) return false
    setSaving(true); setError(''); setMessage('')
    try {
      const response = await fetch(`/api/draft?id=${encodeURIComponent(plan.draft.id)}`, { method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-edit-token': plan.draft.editToken, 'x-dataset-admin-token': adminToken },
        body: JSON.stringify({ selections: updated.map(item => ({ key: item.key, songId: item.song.id, reason: item.reason })) }) })
      const data = await response.json() as { error?: string }
      if (!response.ok) throw new Error(data.error || 'No se guardaron los cambios.')
      setItems(updated); setPlan(current => current ? { ...current, draft: { ...current.draft, status: 'draft' } } : null)
      setMessage('Cambios guardados en el borrador.')
      return true
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se guardaron los cambios.'); return false }
    finally { setSaving(false) }
  }

  function changeSong(item: Item, replacement: Song) {
    if (!plan || items.some(other => other.key !== item.key && other.song.id === replacement.id)) return
    const original = plan.items.find(entry => entry.key === item.key)!
    const next = items.map(entry => entry.key === item.key ? { ...entry, song: replacement,
      reason: replacement.id === original.song.id ? original.reason : '',
      alternatives: options(original).filter(song => song.id !== replacement.id) } : entry)
    void persist(next); setExploreKey(null)
  }

  async function review() {
    if (!plan || saving) return
    if (!await persist(items)) return
    setSaving(true); setError(''); setMessage('')
    try {
      const response = await fetch(`/api/draft?id=${encodeURIComponent(plan.draft.id)}`, { method: 'POST',
        headers: { 'x-edit-token': plan.draft.editToken, 'x-dataset-admin-token': adminToken } })
      const data = await response.json() as { error?: string }
      if (!response.ok) throw new Error(data.error || 'No se pudo revisar.')
      setPlan(current => current ? { ...current, draft: { ...current.draft, status: 'reviewed' } } : null)
      setMessage('Servicio revisado. Ya está disponible en el JSONL.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo revisar.') }
    finally { setSaving(false) }
  }

  async function exportDataset() {
    setError('')
    try {
      const response = await fetch('/api/dataset', { headers: { 'x-dataset-admin-token': adminToken } })
      if (!response.ok) { const data = await response.json() as { error?: string }; throw new Error(data.error || 'No se pudo exportar.') }
      const url = URL.createObjectURL(await response.blob())
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'grafema-services-reviewed.jsonl'; anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo exportar.') }
  }

  const explored = items.find(item => item.key === exploreKey)
  const candidates = explored && plan ? options(plan.items.find(item => item.key === explored.key)!) : []
  const preview = candidates.find(song => song.id === previewId) || explored?.song

  return <>
    <header className="topbar"><a className="wordmark" href="/">GRAFEMA <b>AI</b></a><nav><a href="/">Buscar cantos ↗</a> · <a href="/benchmark.html">Benchmark ↗</a> · <a href="/lotes.html">Lotes ↗</a></nav></header>
    <main className="agent-shell">
      <div className="agent-heading"><span className="eyebrow">AGENTE DE SERVICIOS · DATASET SUPERVISADO</span><h1>Diseña un servicio<br /><em>con intención.</em></h1><p>El agente consulta Grafema y propone un orden; tú lo corriges. Cada propuesta queda guardada para preparar ejemplos revisados de fine tuning.</p></div>
      <div className="agent-layout"><section className="agent-form-card" aria-label="Preferencias del servicio">
        <span className="section-kicker">01 · CONFIGURACIÓN</span><h2>¿Qué deseas comunicar?</h2>{batchDraftId && <div className="batch-open"><p>Servicio del lote {batchDraftId}. Escribe el token de administración para abrirlo y revisarlo, incluso si se cerró la pestaña que lo generó.</p><input type="password" autoComplete="off" aria-label="Token de administración del lote" value={adminToken} onChange={event => setAdminToken(event.target.value)} placeholder="DATASET_ADMIN_TOKEN" /><button type="button" disabled={!adminToken} onClick={() => void loadRecent({ id: batchDraftId, token: '', theme: '', date: '' })}>Abrir servicio del lote</button></div>}<form onSubmit={generate}>
          <label htmlFor="theme">Tema</label><input id="theme" value={theme} onChange={e => setTheme(e.target.value)} minLength={3} maxLength={240} required />
          <label htmlFor="focus">Enfoque <span>(opcional)</span></label><input id="focus" value={focus} onChange={e => setFocus(e.target.value)} maxLength={120} placeholder="Ej. congregacional, testimonial" />
          <label htmlFor="occasion">Ocasión especial <span>(opcional)</span></label><input id="occasion" value={specialOccasion} onChange={e => setSpecialOccasion(e.target.value)} maxLength={120} placeholder="Ej. Navidad, bautismo, aniversario" />
          <label>Recorrido de energía</label><div className="recipe-list">{recipes.map(option => <button className={`recipe ${option.key === recipe ? 'is-active' : ''}`} type="button" aria-pressed={recipe === option.key} key={option.key} onClick={() => setRecipe(option.key)}><span><strong>{option.title}</strong></span><span className="energy-chart" aria-hidden="true">{option.energies.map((level, i) => <i key={i} style={{ height: `${level * 17}%` }} />)}</span></button>)}</div>
          <label htmlFor="count">Número de cantos: <strong>{count}</strong></label><input id="count" type="range" min={2} max={9} value={count} onChange={e => setCount(Number(e.target.value))} />
          <label htmlFor="provider">Proveedor de IA</label><select id="provider" value={provider} onChange={e => { const next = providers.find(option => option.id === e.target.value); if (next) { setProvider(next.id); setModel(next.models[0]?.id || '') } }} disabled={!providers.length}>{providers.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select>
          <label htmlFor="model">Modelo</label><select id="model" value={model} onChange={e => setModel(e.target.value)} disabled={!model}>{providers.find(option => option.id === provider)?.models.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select>
          <label htmlFor="notes">Otras preferencias <span>(opcional)</span></label><textarea id="notes" maxLength={240} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Ej. evitar cantos muy solemnes" rows={3} />
          <button className="generate-button" disabled={busy || !model || theme.trim().length < 3}>{busy ? 'Preparando servicio…' : 'Crear y guardar servicio ↗'}</button>
        </form><p className="form-note">Los borradores se guardan en Supabase. Revisa cada selección antes de aprobar el ejemplo.</p>
        {!!recent.length && <section className="recent-drafts"><strong>Servicios guardados en este navegador</strong>{recent.map(entry => <button type="button" key={entry.id} onClick={() => void loadRecent(entry)}>{entry.theme}<small>{recipes.find(option => option.key === entry.recipe)?.title || 'Receta por consultar'} · {entry.date}</small><small>Modelo: {entry.model || 'Consultar servicio'}</small></button>)}</section>}
      </section>
      <section className="agent-output" aria-live="polite">
        {error && <div className="alert" role="alert">{error}</div>}{message && <div className="success-note" role="status">{message}</div>}
        {busy && <div className="live-progress" role="status"><span className="spinner" /><h2>Consultas en tiempo real</h2><ol>{progress.map((event, index) => <li key={index}><strong>{event.slot || event.type}</strong> {event.message}{event.query && <small>Consulta: {event.query}</small>}</li>)}</ol></div>}
        {!plan && !busy && <div className="agent-empty"><span className="agent-empty-icon">✳</span><h2>Tu propuesta aparecerá aquí</h2><p>Describe el servicio o recupera un borrador anterior.</p></div>}
        {plan && <><div className="plan-heading"><div><span className="section-kicker">02 · PROPUESTA EDITABLE</span><h2>{plan.theme}</h2><p>{items.length} cantos · {recipes.find(r => r.key === plan.recipe)?.title}</p></div><span className="model-badge">{plan.provider}: {plan.model}</span></div>
          <p className={`draft-status ${plan.draft.status}`}>{plan.draft.status === 'reviewed' ? '✓ Revisado · incluido en el dataset' : '● Borrador guardado · pendiente de revisión'}</p>
          {plan.missingSlots.length > 0 && <p className="alert">Sin resultados para: {plan.missingSlots.join(', ')}.</p>}
          <div className="plan-list">{items.map((item, index) => <article className="plan-item" key={item.key}><div className="plan-step"><span>{String(index + 1).padStart(2, '0')}</span><i /></div><div className="plan-content"><div className="plan-position"><span>{item.slot.title}</span><span>Energía objetivo {item.slot.targetEnergy}/5</span></div><h3>{item.song.title}</h3><Evidence song={item.song} /><label className="swap-label" htmlFor={`reason-${item.key}`}>Motivo de selección {item.reason.trim().length < 12 && <em>· completa antes de revisar</em>}</label><textarea id={`reason-${item.key}`} value={item.reason} rows={2} maxLength={400} onChange={event => setItems(current => current.map(entry => entry.key === item.key ? { ...entry, reason: event.target.value } : entry))} /><button type="button" className="browse-button" onClick={() => { setExploreKey(item.key); setPreviewId(item.song.id) }}>Explorar alternativas con letra y etiquetas ↗</button></div></article>)}</div>
          <button type="button" className="save-motives" disabled={saving} onClick={() => void persist(items)}>{saving ? 'Guardando…' : 'Guardar motivos editados'}</button>
          <details className="agent-trace"><summary>Ver búsquedas realizadas ({plan.searches.length})</summary><ol>{plan.searches.map((trace, index) => <li key={index}><strong>{trace.slot}</strong> · {trace.query} <small>({trace.count} candidatos)</small></li>)}</ol></details>
          <section className="dataset-actions"><span className="section-kicker">03 · DATASET PARA FINE TUNING</span><p>Revisa los motivos y los cantos. El JSONL incluye solo servicios aprobados.</p><label htmlFor="admin-token">Token de revisión</label><input id="admin-token" type="password" autoComplete="off" value={adminToken} onChange={event => setAdminToken(event.target.value)} placeholder="DATASET_ADMIN_TOKEN" /><div><button type="button" disabled={!adminToken || saving || busy} onClick={() => void review()}>Marcar como revisado</button><button type="button" disabled={!adminToken || saving} onClick={() => void exportDataset()}>Descargar JSONL ↗</button></div></section>
        </>}
      </section></div>
      {explored && preview && <div className="candidate-overlay" role="dialog" aria-modal="true" aria-label={`Alternativas para ${explored.slot.title}`}><div className="candidate-modal"><header><div><span className="section-kicker">EXPLORAR ALTERNATIVAS · {explored.slot.title.toUpperCase()}</span><h2>Elige con la letra a la vista</h2></div><button type="button" onClick={() => setExploreKey(null)} aria-label="Cerrar">✕</button></header><div className="candidate-layout"><div className="candidate-list">{candidates.map(candidate => { const occupied = items.some(item => item.key !== explored.key && item.song.id === candidate.id); return <button type="button" key={candidate.id} disabled={occupied} className={preview.id === candidate.id ? 'active' : ''} onClick={() => setPreviewId(candidate.id)}><strong>{candidate.title}</strong><small>{typeof candidate.labels?.energia?.valor === 'number' ? `Energía ${candidate.labels.energia.valor.toFixed(1)}/5` : 'Energía sin estimar'}{occupied ? ' · ya usado' : ''}</small><span>{Object.keys(candidate.match_labels?.temas || candidate.labels?.temas || {}).slice(0, 3).join(' · ').replaceAll('_', ' ')}</span></button> })}</div><div className="candidate-detail"><h3>{preview.title}</h3><Evidence song={preview} full /><button type="button" disabled={saving || items.some(item => item.key !== explored.key && item.song.id === preview.id) || preview.id === explored.song.id} onClick={() => changeSong(explored, preview)}>{preview.id === explored.song.id ? 'Canto actual' : 'Usar este canto'}</button></div></div></div></div>}
    </main><footer><span>Grafema AI · Dataset supervisado de servicios</span><a href="/">Volver al buscador</a></footer>
  </>
}
