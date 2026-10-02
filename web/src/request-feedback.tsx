import { useEffect, useState } from 'react'

export type RequestFailure = {
  title: string
  stage: string
  detail: string
  endpoint: string
  status?: number
  traceId?: string
  hint?: string
}

function safeEndpoint(url: string) {
  try { const parsed = new URL(url, window.location.origin); return `${parsed.origin}${parsed.pathname}` }
  catch { return url.split('?')[0] }
}

function errorFields(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export async function responseFailure(response: Response, title: string, fallbackStage: string): Promise<RequestFailure> {
  let payload: unknown
  try { payload = await response.clone().json() } catch { try { payload = await response.clone().text() } catch { payload = '' } }
  const root = errorFields(errorFields(payload).detail || payload)
  const rawDetail = root.message || root.error || errorFields(payload).detail || payload
  let detail = typeof rawDetail === 'string' && rawDetail.trim()
    ? rawDetail.trim().slice(0, 600) : `El servicio respondió con HTTP ${response.status} ${response.statusText || ''}`.trim()
  if (typeof root.provider_detail === 'string' && root.provider_detail.trim()) detail += ` Detalle del proveedor: ${root.provider_detail.trim().slice(0, 300)}`
  if (typeof root.upstream_status === 'number') detail += ` Código del proveedor: HTTP ${root.upstream_status}.`
  return {
    title,
    stage: typeof root.stage === 'string' ? root.stage : fallbackStage,
    detail,
    endpoint: safeEndpoint(response.url),
    status: response.status,
    traceId: typeof root.trace_id === 'string' ? root.trace_id : undefined,
    hint: typeof root.hint === 'string' ? root.hint : undefined,
  }
}

export function networkFailure(reason: unknown, title: string, stage: string, url: string): RequestFailure {
  const detail = reason instanceof Error ? reason.message : String(reason || 'Error de red desconocido')
  return {
    title,
    stage,
    detail,
    endpoint: safeEndpoint(url),
    hint: navigator.onLine
      ? 'No llegó una respuesta HTTP. El servicio de Render puede estar iniciando, la URL puede ser incorrecta o CORS puede estar bloqueando la conexión. Espera unos segundos y vuelve a intentar.'
      : 'Este dispositivo no tiene conexión a Internet.',
  }
}

export function messageFailure(title: string, stage: string, detail: string, url: string): RequestFailure {
  return { title, stage, detail, endpoint: safeEndpoint(url) }
}

export function normalizeFailure(reason: unknown, title: string, stage: string, url: string): RequestFailure {
  const candidate = errorFields(reason)
  if (typeof candidate.title === 'string' && typeof candidate.stage === 'string'
      && typeof candidate.detail === 'string' && typeof candidate.endpoint === 'string') return reason as RequestFailure
  return networkFailure(reason, title, stage, url)
}

export function useWaitSeconds(active: boolean) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!active) { setSeconds(0); return }
    setSeconds(0)
    const timer = window.setInterval(() => setSeconds(value => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [active])
  return seconds
}

export function ErrorNotice({ failure }: { failure: RequestFailure }) {
  return <div className="alert request-error" role="alert">
    <strong>{failure.title}</strong>
    <dl><div><dt>Etapa</dt><dd>{failure.stage}</dd></div><div><dt>Detalle</dt><dd>{failure.detail}</dd></div>
      {failure.status && <div><dt>HTTP</dt><dd>{failure.status}</dd></div>}
      {failure.traceId && <div><dt>Traza</dt><dd><code>{failure.traceId}</code></dd></div>}
      <div><dt>Servicio</dt><dd><code>{failure.endpoint}</code></dd></div></dl>
    {failure.hint && <p>{failure.hint}</p>}
  </div>
}

export function WaitingNotice({ seconds, service, action }: { seconds: number; service: string; action: string }) {
  const waking = seconds >= 8
  return <div className="waiting-notice" role="status">
    <span className="spinner" aria-hidden="true" />
    <div><strong>{waking ? `Estamos esperando a ${service}` : action}</strong>
      <p>{waking ? 'El plan gratuito de Render puede pausar el servicio. La primera solicitud puede tardar mientras vuelve a iniciar; mantén esta página abierta.' : 'Enviando la solicitud. Si el servicio estaba pausado, el arranque puede tardar unos segundos.'}</p>
      <small>{seconds} s transcurridos</small></div>
  </div>
}
