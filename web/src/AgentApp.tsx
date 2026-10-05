import { useEffect, useState, type FormEvent } from 'react'
import './agent.css'
import { agentApiUrl } from './agent-api'
import { recipes, rememberService, savedServices, type Recipe, type Recent } from './agent-shared'
import { AppShell } from './components/app-shell'
import { ErrorNotice, WaitingNotice, messageFailure, normalizeFailure, responseFailure, type RequestFailure, useWaitSeconds } from './request-feedback'

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
const songOptions = (item: Item) => [item.song, ...item.alternatives]
const PUBLIC_DEMO_DEFAULTS = {
  focus: '',
  specialOccasion: '',
  count: 5,
} as const

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

async function readEvents(response: Response, url: string, onEvent: (name: string, data: unknown) => void) {
  if (!response.ok) throw await responseFailure(response, 'El agente no pudo crear el servicio.', 'Inicio de la generación')
  if (!response.body) throw messageFailure('El agente no pudo crear el servicio.', 'Lectura de la respuesta en tiempo real', 'El servidor respondió sin un flujo de datos.', url)
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
  const [recipe, setRecipe] = useState<Recipe>('descendente')
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
  const [connecting, setConnecting] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<RequestFailure | null>(null)
  const [message, setMessage] = useState('')
  const connectionSeconds = useWaitSeconds(connecting)
  const generationSeconds = useWaitSeconds(busy)

  useEffect(() => {
    setRecent(savedServices())
    let active = true
    const url = agentApiUrl('/api/service')
    fetch(url).then(async response => {
      if (!response.ok) throw await responseFailure(response, 'No se pudo conectar con el agente.', 'Carga de proveedores y modelos')
      return response.json() as Promise<{ providers: Provider[] }>
    }).then(data => {
      if (!active) return
      setProviders(data.providers || [])
      const first = data.providers?.[0]; if (first) { setProvider(first.id); setModel(first.models[0]?.id || '') }
    }).catch(reason => { if (active) setError(normalizeFailure(reason, 'No se pudo conectar con el agente.', 'Conexión inicial con Render', url)) })
      .finally(() => { if (active) setConnecting(false) })
    return () => { active = false }
  }, [])

  function remember(result: Plan) { setRecent(rememberService({ id: result.draft.id, token: result.draft.editToken,
    theme: result.theme, recipe: result.recipe, model: result.model, provider: result.provider })) }

  async function generate(event: FormEvent) {
    event.preventDefault(); if (busy || !model) return
    setBusy(true); setError(null); setMessage(''); setPlan(null); setItems([]); setProgress([])
    let completed = false
    const url = agentApiUrl('/api/service')
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ theme, recipe, notes, provider, model, ...PUBLIC_DEMO_DEFAULTS }) })
      await readEvents(response, url, (name, payload) => {
        if (name === 'status') setProgress(current => [...current, payload as Progress])
        if (name === 'error') { const failure = payload as { error: string; stage?: string; trace_id?: string; hint?: string }; throw {
          title: 'El agente no pudo crear el servicio.', stage: failure.stage || 'Generación del plan', detail: failure.error,
          endpoint: url, traceId: failure.trace_id, hint: failure.hint,
        } satisfies RequestFailure }
        if (name === 'result') { const result = payload as Plan; completed = true; setPlan(result); setItems(result.items); remember(result)
          setMessage('Propuesta creada. Puedes revisar los cantos y ajustar los motivos.') }
      })
      if (!completed) throw messageFailure('El agente no pudo crear el servicio.', 'Finalización del flujo', 'El flujo terminó sin devolver ni guardar una propuesta.', url)
    } catch (reason) { setError(normalizeFailure(reason, 'El agente no pudo crear el servicio.', 'Conexión con el agente en Render', url)) }
    finally { setBusy(false) }
  }

  async function loadRecent(entry: Recent) {
    setError(null); setMessage('')
    const url = agentApiUrl(`/api/draft?id=${encodeURIComponent(entry.id)}`)
    try {
      const response = await fetch(url, { headers: { 'x-edit-token': entry.token } })
      if (!response.ok) { setError(await responseFailure(response, 'No se pudo recuperar el borrador.', 'Lectura del borrador')); return }
      const data = await response.json() as { error?: string; plan: Plan; request: { theme: string; recipe: Recipe; count: number; notes: string; focus: string; specialOccasion: string }; selections: Selection[]; status: 'draft' | 'reviewed' }
      setPlan({ ...data.plan, theme: data.request.theme, recipe: data.request.recipe, draft: { id: entry.id, editToken: entry.token, status: data.status } })
      setItems(data.plan.items.map(original => { const selection = data.selections.find(item => item.key === original.key)
        const song = songOptions(original).find(candidate => candidate.id === selection?.songId) || original.song
        return { ...original, song, reason: selection?.reason ?? original.reason, alternatives: songOptions(original).filter(candidate => candidate.id !== song.id) } }))
      setTheme(data.request.theme); setRecipe(data.request.recipe); setNotes(data.request.notes || '')
      if (entry.token) setRecent(current => current.map(saved => saved.id === entry.id ? { ...saved, recipe: data.request.recipe,
        model: data.plan.model, provider: data.plan.provider } : saved))
      setMessage('Propuesta recuperada.')
    } catch (reason) { setError(normalizeFailure(reason, 'No se pudo recuperar el borrador.', 'Conexión con el almacén de borradores', url)) }
  }

  async function persist(updated: Item[]) {
    if (!plan || saving) return false
    setSaving(true); setError(null); setMessage('')
    const url = agentApiUrl(`/api/draft?id=${encodeURIComponent(plan.draft.id)}`)
    try {
      const response = await fetch(url, { method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-edit-token': plan.draft.editToken },
        body: JSON.stringify({ selections: updated.map(item => ({ key: item.key, songId: item.song.id, reason: item.reason })) }) })
      if (!response.ok) { setError(await responseFailure(response, 'No se guardaron los cambios.', 'Actualización del borrador')); return false }
      setItems(updated); setPlan(current => current ? { ...current, draft: { ...current.draft, status: 'draft' } } : null)
      setMessage('Cambios guardados en el borrador.')
      return true
    } catch (reason) { setError(normalizeFailure(reason, 'No se guardaron los cambios.', 'Conexión al guardar el borrador', url)); return false }
    finally { setSaving(false) }
  }

  function changeSong(item: Item, replacement: Song) {
    if (!plan || items.some(other => other.key !== item.key && other.song.id === replacement.id)) return
    const original = plan.items.find(entry => entry.key === item.key)!
    const next = items.map(entry => entry.key === item.key ? { ...entry, song: replacement,
      reason: replacement.id === original.song.id ? original.reason : '',
      alternatives: songOptions(original).filter(song => song.id !== replacement.id) } : entry)
    void persist(next); setExploreKey(null)
  }

  const explored = items.find(item => item.key === exploreKey)
  const candidates = explored && plan ? songOptions(plan.items.find(item => item.key === explored.key)!) : []
  const preview = candidates.find(song => song.id === previewId) || explored?.song
  const hasSingleProviderAndModel = providers.length === 1 && providers[0].models.length === 1

  return <AppShell>
    <main className="agent-shell">
      <div className="agent-heading"><span className="eyebrow">AGENTE DE REPERTORIOS · DEMOSTRACIÓN</span><h1>Diseña un repertorio<br /><em>con intención.</em></h1><p>Describe el mensaje o la ocasión. El agente consulta el catálogo y propone una secuencia de cantos que puedes revisar y ajustar.</p></div>
      <div className="agent-layout"><section className="agent-form-card" aria-label="Preferencias del repertorio">
        <span className="section-kicker">01 · CONFIGURACIÓN</span><h2>Configuración del repertorio</h2><form onSubmit={generate}>
          <div><label htmlFor="theme">Tema</label><input id="theme" required minLength={3} maxLength={240} value={theme} onChange={event => setTheme(event.target.value)} placeholder="Describe el mensaje o la ocasión" /></div>
          <div><label>Recorrido de energía</label><div className="recipe-list">{recipes.map(option => <button className={`recipe ${option.key === recipe ? 'is-active' : ''}`} type="button" aria-pressed={recipe === option.key} key={option.key} onClick={() => setRecipe(option.key)}><span><strong>{option.title}</strong></span><span className="energy-chart" aria-hidden="true">{option.energies.map((level, index) => <i key={index} style={{ height: `${level * 17}%` }} />)}</span></button>)}</div></div>
          <div><label htmlFor="notes">Otras preferencias <span>(opcional)</span></label><textarea id="notes" maxLength={240} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Ej. evitar cantos muy solemnes" rows={3} /></div>
          {!hasSingleProviderAndModel && <>
            <div><label htmlFor="provider">Proveedor de IA</label><select id="provider" value={provider} onChange={event => { const next = providers.find(option => option.id === event.target.value); if (next) { setProvider(next.id); setModel(next.models[0]?.id || '') } }} disabled={!providers.length}>{providers.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></div>
            <div><label htmlFor="model">Modelo</label><select id="model" value={model} onChange={event => setModel(event.target.value)} disabled={!model}>{providers.find(option => option.id === provider)?.models.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></div>
          </>}
          <button className="generate-button" disabled={busy || connecting || !model || theme.trim().length < 3}>{connecting ? 'Conectando con el agente…' : busy ? 'Preparando servicio…' : 'Crear y guardar servicio ↗'}</button>
        </form>{connecting && <WaitingNotice seconds={connectionSeconds} service="el agente en Render" action="Conectando con el agente y cargando los modelos…" />}<p className="form-note">Esta es una demostración: revisa siempre las letras y el contexto antes de utilizar una propuesta.</p>
        {!!recent.length && <section className="recent-drafts"><strong>Propuestas recientes en este navegador</strong>{recent.map(entry => <button type="button" key={entry.id} onClick={() => void loadRecent(entry)}>{entry.theme}<small>{recipes.find(option => option.key === entry.recipe)?.title || 'Recorrido por consultar'} · {entry.date}</small></button>)}</section>}
      </section>
      <section className="agent-output" aria-live="polite">
        {error && <ErrorNotice failure={error} />}{message && <div className="success-note" role="status">{message}</div>}
        {busy && <div className="live-progress" role="status"><WaitingNotice seconds={generationSeconds} service="los servicios de Grafema AI en Render" action="Preparando el agente y consultando el catálogo…" />{progress.length > 0 && <><h2>Consultas en tiempo real</h2><ol>{progress.map((event, index) => <li key={index}><strong>{event.slot || event.type}</strong> {event.message}{event.query && <small>Consulta: {event.query}</small>}</li>)}</ol></>}</div>}
        {!plan && !busy && <div className="agent-empty"><span className="agent-empty-icon">✳</span><h2>Tu propuesta aparecerá aquí</h2><p>Describe lo que necesitas o abre una propuesta reciente.</p></div>}
        {plan && <><div className="plan-heading"><div><span className="section-kicker">02 · PROPUESTA EDITABLE</span><h2>{plan.theme}</h2><p>{items.length} cantos · {recipes.find(r => r.key === plan.recipe)?.title}</p></div></div>
          <p className="draft-status reviewed">✓ Propuesta generada · editable en esta demostración</p>
          {plan.missingSlots.length > 0 && <p className="alert">Sin resultados para: {plan.missingSlots.join(', ')}.</p>}
          <div className="plan-list">{items.map((item, index) => <article className="plan-item" key={item.key}><div className="plan-step"><span>{String(index + 1).padStart(2, '0')}</span><i /></div><div className="plan-content"><div className="plan-position"><span>{item.slot.title}</span><span>Energía objetivo {item.slot.targetEnergy}/5</span></div><h3>{item.song.title}</h3><Evidence song={item.song} /><label className="swap-label" htmlFor={`reason-${item.key}`}>Motivo de selección {item.reason.trim().length < 12 && <em>· completa antes de revisar</em>}</label><textarea id={`reason-${item.key}`} value={item.reason} rows={2} maxLength={400} onChange={event => setItems(current => current.map(entry => entry.key === item.key ? { ...entry, reason: event.target.value } : entry))} /><button type="button" className="browse-button" onClick={() => { setExploreKey(item.key); setPreviewId(item.song.id) }}>Explorar alternativas con letra y etiquetas ↗</button></div></article>)}</div>
          <button type="button" className="save-motives" disabled={saving} onClick={() => void persist(items)}>{saving ? 'Guardando…' : 'Guardar motivos editados'}</button>
          <details className="agent-trace"><summary>Ver búsquedas realizadas ({plan.searches.length})</summary><ol>{plan.searches.map((trace, index) => <li key={index}><strong>{trace.slot}</strong> · {trace.query} <small>({trace.count} candidatos)</small></li>)}</ol></details>
          <p className="demo-caution">La propuesta es una ayuda para explorar el catálogo; la selección final corresponde al equipo responsable de música de cada comunidad.</p>
        </>}
      </section></div>
      {explored && preview && <div className="candidate-overlay" role="dialog" aria-modal="true" aria-label={`Alternativas para ${explored.slot.title}`}><div className="candidate-modal"><header><div><span className="section-kicker">EXPLORAR ALTERNATIVAS · {explored.slot.title.toUpperCase()}</span><h2>Elige con la letra a la vista</h2></div><button type="button" onClick={() => setExploreKey(null)} aria-label="Cerrar">✕</button></header><div className="candidate-layout"><div className="candidate-list">{candidates.map(candidate => { const occupied = items.some(item => item.key !== explored.key && item.song.id === candidate.id); return <button type="button" key={candidate.id} disabled={occupied} className={preview.id === candidate.id ? 'active' : ''} onClick={() => setPreviewId(candidate.id)}><strong>{candidate.title}</strong><small>{typeof candidate.labels?.energia?.valor === 'number' ? `Energía ${candidate.labels.energia.valor.toFixed(1)}/5` : 'Energía sin estimar'}{occupied ? ' · ya usado' : ''}</small><span>{Object.keys(candidate.match_labels?.temas || candidate.labels?.temas || {}).slice(0, 3).join(' · ').replaceAll('_', ' ')}</span></button> })}</div><div className="candidate-detail"><h3>{preview.title}</h3><Evidence song={preview} full /><button type="button" disabled={saving || items.some(item => item.key !== explored.key && item.song.id === preview.id) || preview.id === explored.song.id} onClick={() => changeSong(explored, preview)}>{preview.id === explored.song.id ? 'Canto actual' : 'Usar este canto'}</button></div></div></div></div>}
    </main><footer><span>Grafema AI · Agente demostrativo de repertorios</span><a href="/informacion.html">Cómo funciona esta demostración</a></footer>
  </AppShell>
}
