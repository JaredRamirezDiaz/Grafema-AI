import { useEffect, useRef, useState } from 'react'
import { agentApiUrl } from './agent-api'
import { recipes, rememberService, type Recipe } from './agent-shared'
import './agent.css'
import './batch.css'

type Provider = { id: 'cloudflare' | 'openrouter'; label: string; models: { id: string; label: string }[] }
type Scenario = { id: string; enabled: boolean; request: { theme: string; specialOccasion: string; focus: string; count: number; recipe: Recipe };
  saved: { id: string; status: 'draft' | 'reviewed'; model: string; provider: string } | null }
type Batch = { target: number; total: number; scenarios: Scenario[] }

export default function BatchApp() {
  const [adminToken, setAdminToken] = useState('')
  const [providers, setProviders] = useState<Provider[]>([])
  const [provider, setProvider] = useState<Provider['id']>('cloudflare')
  const [model, setModel] = useState('')
  const [batch, setBatch] = useState<Batch | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [running, setRunning] = useState(false)
  const [current, setCurrent] = useState('')
  const stop = useRef(false)

  useEffect(() => {
    fetch(agentApiUrl('/api/service')).then(response => response.json() as Promise<{ providers: Provider[] }>).then(data => {
      const entries = data.providers || []
      setProviders(entries)
      if (entries[0]) { setProvider(entries[0].id); setModel(entries[0].models[0]?.id || '') }
    }).catch(() => setError('No se pudieron cargar los modelos configurados.'))
  }, [])

  async function refresh(token = adminToken, clearError = true): Promise<Batch | null> {
    if (clearError) setError('')
    try {
      const response = await fetch(agentApiUrl('/api/batch'), { headers: { 'x-dataset-admin-token': token } })
      const data = await response.json() as Batch & { error?: string }
      if (!response.ok) throw new Error(data.error || 'No se pudo consultar el avance.')
      setBatch(data)
      return data
    } catch (reason) {
      if (clearError) setError(reason instanceof Error ? reason.message : 'No se pudo consultar el avance.')
      return null
    }
  }

  async function runTen() {
    if (running || !batch || !model) return
    const pending = batch.scenarios.filter(item => item.enabled && !item.saved).slice(0, 10)
    if (!pending.length) return
    stop.current = false; setRunning(true); setError(''); setMessage('')
    let done = 0
    try {
      for (const scenario of pending) {
        if (stop.current) break
        setCurrent(`${scenario.id} · ${scenario.request.theme}`)
        const response = await fetch(agentApiUrl('/api/batch'), { method: 'POST', headers: {
          'Content-Type': 'application/json', 'x-dataset-admin-token': adminToken,
        }, body: JSON.stringify({ scenarioId: scenario.id, provider, model }) })
        const data = await response.json() as { error?: string; draft?: { id: string; editToken: string }; theme?: string; recipe?: Recipe; model?: string; provider?: string }
        if (!response.ok || !data.draft) throw new Error(`${scenario.id}: ${data.error || 'No se guardó la propuesta.'}`)
        rememberService({ id: data.draft.id, token: data.draft.editToken,
          theme: data.theme || scenario.request.theme, recipe: data.recipe || scenario.request.recipe,
          provider: data.provider || provider, model: data.model || model })
        setBatch(previous => previous && ({ ...previous, scenarios: previous.scenarios.map(item => item.id === scenario.id
          ? { ...item, saved: { id: data.draft!.id, status: 'draft', model: data.model || model, provider: data.provider || provider } } : item) }))
        done++
        setMessage(`${done} de ${pending.length} guardados en esta ejecución.`)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Se interrumpió el lote.')
    } finally {
      setCurrent(''); setRunning(false)
      await refresh(adminToken, false)
    }
  }

  const active = batch?.scenarios.filter(scenario => scenario.enabled) || []
  const saved = active.filter(scenario => scenario.saved).length
  const reviewed = active.filter(scenario => scenario.saved?.status === 'reviewed').length

  return <><header className="topbar"><a className="wordmark" href="/">GRAFEMA <b>AI</b></a><nav><a href="/agente.html">Agente y revisión ↗</a></nav></header>
    <main className="agent-shell batch-shell"><div className="agent-heading"><span className="eyebrow">GENERACIÓN TEMPORAL · DATASET DE PRUEBA</span><h1>Servicios por lotes.</h1><p>100 solicitudes predefinidas; ejecuta las habilitadas de diez en diez. Se generan de forma secuencial y quedan como borradores para tu revisión humana.</p></div>
      <div className="batch-controls"><section className="agent-form-card"><span className="section-kicker">CONTROL DE GENERACIÓN</span><h2>Ejecutar el siguiente lote</h2>
        <label htmlFor="batch-token">Token de administración</label><input id="batch-token" type="password" autoComplete="off" value={adminToken} onChange={event => setAdminToken(event.target.value)} placeholder="DATASET_ADMIN_TOKEN" />
        <button className="batch-secondary" type="button" disabled={running || !adminToken} onClick={() => void refresh()}>Cargar avance desde Supabase</button>
        <label htmlFor="batch-provider">Proveedor de IA</label><select id="batch-provider" value={provider} disabled={running} onChange={event => { const next = providers.find(entry => entry.id === event.target.value); if (next) { setProvider(next.id); setModel(next.models[0]?.id || '') } }}>
          {providers.map(entry => <option value={entry.id} key={entry.id}>{entry.label}</option>)}</select>
        <label htmlFor="batch-model">Modelo</label><select id="batch-model" value={model} disabled={running} onChange={event => setModel(event.target.value)}>{providers.find(entry => entry.id === provider)?.models.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select>
        <button className="generate-button" type="button" disabled={running || !batch || !model || saved >= active.length} onClick={() => void runTen()}>{running ? 'Generando servicio…' : 'Generar próximos 10 pendientes ↗'}</button>
        {running && <button type="button" className="batch-secondary" onClick={() => { stop.current = true }}>Detener después del actual</button>}
        <p className="form-note">Se cobra una generación por cada intento. Si un caso falla, el lote se detiene y puedes reanudarlo; los guardados no se repiten. El token solo permanece en esta pestaña.</p>
      </section><section className="agent-output"><span className="section-kicker">AVANCE EN SUPABASE</span><h2>{batch ? `${saved} de ${batch.target} servicios guardados` : 'Carga el avance para comenzar'}</h2>
        {batch && <><div className="batch-meter"><div style={{ width: `${Math.round(saved / active.length * 100)}%` }} /></div><p>{reviewed} revisados · {saved - reviewed} borradores · {active.length - saved} pendientes · {batch.total} solicitudes definidas</p></>}
        {current && <p className="batch-current" role="status"><span className="spinner" />Generando {current}</p>}
        {message && <div className="success-note" role="status">{message}</div>}{error && <div className="alert" role="alert">{error}</div>}
        <p>Abre <a href="/agente.html">la pantalla del agente</a> para revisar las letras, ajustar las canciones y marcar los servicios como revisados. Solo esos servicios entran al JSONL.</p>
      </section></div>
      {batch && <section className="batch-list"><div className="batch-list-heading"><span className="section-kicker">SOLICITUDES PREPARADAS</span><strong>{batch.total} escenarios</strong></div>
        {batch.scenarios.map(scenario => <article className={`batch-row ${!scenario.enabled ? 'batch-disabled' : ''}`} key={scenario.id}>
          <span className="batch-id">{scenario.id}</span><div><strong>{scenario.request.theme}</strong><p>{scenario.request.specialOccasion} · {scenario.request.focus} · {scenario.request.count} cantos</p><small>{recipes.find(entry => entry.key === scenario.request.recipe)?.title}</small></div>
          <div className="batch-result"><strong>{!scenario.enabled ? 'Fuera del objetivo actual' : scenario.saved?.status === 'reviewed' ? 'Revisado' : scenario.saved ? 'Guardado' : 'Pendiente'}</strong>
            {scenario.saved && <><small>{scenario.saved.provider}: {scenario.saved.model}</small><a href={`/agente.html?draft=${encodeURIComponent(scenario.saved.id)}`}>Abrir y revisar ↗</a></>}</div>
        </article>)}</section>}
    </main><footer><span>Grafema AI · Servicios de prueba</span><a href="/agente.html">Volver al agente</a></footer></>
}
