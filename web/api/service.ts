import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createService, requestSchema, type Song } from './_lib/service-agent.js'
import { availableModels } from './_lib/models.js'
import { saveDraft } from './_lib/drafts.js'

export async function searchCatalog(query: string): Promise<Song[]> {
  const apiBase = process.env.GRAFEMA_API_URL?.replace(/\/$/, '')
  if (!apiBase || !/^https?:\/\//.test(apiBase)) throw new Error('Configura GRAFEMA_API_URL en el servidor.')
  const response = await fetch(`${apiBase}/search/enhanced`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, mode: 'labels', limit: 15 }), signal: AbortSignal.timeout(45000),
  })
  if (!response.ok) throw new Error(`La API de búsqueda respondió ${response.status}`)
  const data: unknown = await response.json()
  if (!data || typeof data !== 'object' || !('results' in data) || !Array.isArray(data.results)) throw new Error('Respuesta de búsqueda inválida')
  return (data.results as Song[]).filter(song => typeof song.id === 'string' && typeof song.title === 'string')
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'GET') return res.status(200).json({ providers: availableModels() })
  if (req.method !== 'POST') return res.status(405).json({ error: 'Usa POST.' })
  const parsed = requestSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Revisa tema, receta, número de cantos y preferencias.' })
  const streaming = req.headers.accept?.includes('text/event-stream')
  const emit = (event: string, data: unknown) => { if (streaming && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) }
  if (streaming) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders?.()
    emit('status', { type: 'planning', message: 'Preparando el servicio…' })
  }
  try {
    const service = await createService(parsed.data, searchCatalog, progress => emit('status', progress))
    emit('status', { type: 'saving', message: 'Guardando el borrador para el dataset…' })
    const draft = await saveDraft(parsed.data, service)
    const result = { ...service, draft }
    if (streaming) { emit('result', result); return res.end() }
    return res.status(200).json(result)
  } catch (error) {
    console.error('Generación de servicio:', error instanceof Error ? error.message : error)
    const message = error instanceof Error && /Supabase|borrador|migración 003|SUPABASE/.test(error.message)
      ? error.message : 'No pudimos generar el servicio. Revisa los registros del agente y la configuración del modelo.'
    if (streaming) { emit('error', { error: message }); return res.end() }
    return res.status(502).json({ error: message })
  }
}
