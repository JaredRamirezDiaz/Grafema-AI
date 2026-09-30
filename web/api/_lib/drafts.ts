import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { ServiceItem, ServiceRequest, Song } from './service-agent.js'

type Selection = { key: string; songId: string; reason: string }
export type DraftRow = { id: string; edit_token_hash: string; status: 'draft' | 'reviewed'; request: ServiceRequest;
  original: { items: ServiceItem[]; searches: unknown[]; model: string; provider: string }; curated: Selection[];
  created_at: string; reviewed_at: string | null; batch_scenario_id?: string | null }

function settings() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '')
  const key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error('Configura SUPABASE_URL y SUPABASE_SECRET_KEY en web/.env.local y aplica la migración 003.')
  return { url: `${url}/rest/v1/service_training_drafts`, headers: { apikey: key, 'Content-Type': 'application/json' } }
}

async function query(path: string, method = 'GET', body?: unknown): Promise<DraftRow[]> {
  const { url, headers } = settings()
  const response = await fetch(url + path, { method, headers: { ...headers, Prefer: 'return=representation' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error(`No se pudo guardar o leer el borrador (Supabase ${response.status}). Revisa la migración 003 y las credenciales.`)
  const data: unknown = await response.json()
  if (!Array.isArray(data)) throw new Error('Supabase no devolvió una lista válida de borradores.')
  return data as DraftRow[]
}

export function hashToken(token: string) { return createHash('sha256').update(token).digest('hex') }
export function sameToken(token: string, hash: string) {
  if (!/^[a-f0-9]{64}$/.test(hash)) return false
  return timingSafeEqual(Buffer.from(hashToken(token), 'hex'), Buffer.from(hash, 'hex'))
}

export function publicDraft(row: DraftRow) {
  return { id: row.id, status: row.status, request: row.request, plan: row.original, selections: row.curated,
    createdAt: row.created_at, reviewedAt: row.reviewed_at }
}

export async function saveDraft(request: ServiceRequest, plan: DraftRow['original'], scenarioId?: string) {
  const id = randomUUID()
  const editToken = randomBytes(32).toString('hex')
  const curated = plan.items.map(item => ({ key: item.key, songId: item.song.id, reason: item.reason }))
  const rows = await query('', 'POST', { id, edit_token_hash: hashToken(editToken), request, original: plan, curated,
    ...(scenarioId ? { batch_scenario_id: scenarioId } : {}) })
  if (rows.length !== 1) throw new Error('El borrador no se confirmó en Supabase.')
  return { id, editToken, status: 'draft' as const }
}

export async function loadDraft(id: string, editToken: string) {
  const rows = await query(`?id=eq.${encodeURIComponent(id)}&select=*`)
  if (rows.length !== 1 || !sameToken(editToken, rows[0].edit_token_hash)) return null
  return rows[0]
}

export async function loadDraftAsAdmin(id: string) {
  const rows = await query(`?id=eq.${encodeURIComponent(id)}&select=*`)
  return rows.length === 1 ? rows[0] : null
}

export function validateSelections(row: DraftRow, updates: Selection[]): Selection[] {
  const originals = row.original.items
  if (updates.length !== originals.length || new Set(updates.map(item => item.key)).size !== updates.length) throw new Error('La selección está incompleta.')
  const used = new Set<string>()
  return originals.map(original => {
    const update = updates.find(item => item.key === original.key)
    const allowed = [original.song, ...original.alternatives]
    if (!update || !allowed.some(song => song.id === update.songId) || used.has(update.songId) ||
      typeof update.reason !== 'string' || update.reason.length > 400) throw new Error('Canto o motivo inválido para este momento.')
    used.add(update.songId)
    return { key: original.key, songId: update.songId, reason: update.reason.trim() }
  })
}

export async function updateDraft(row: DraftRow, selections: Selection[]) {
  const curated = validateSelections(row, selections)
  const result = await query(`?id=eq.${encodeURIComponent(row.id)}`, 'PATCH',
    { curated, status: 'draft', reviewed_at: null, updated_at: new Date().toISOString() })
  if (result.length !== 1) throw new Error('No se pudo actualizar el borrador.')
  return publicDraft(result[0])
}

export function adminAuthorized(token: string) {
  const admin = process.env.DATASET_ADMIN_TOKEN
  return !!admin && admin.length >= 16 && sameToken(token, hashToken(admin))
}

export async function reviewDraft(row: DraftRow) {
  if (row.curated.length !== row.request.count || row.original.items.length !== row.request.count)
    throw new Error('Faltan cantos para completar este servicio; no puede entrar al dataset todavía.')
  if (row.curated.some(selection => selection.reason.trim().length < 12)) throw new Error('Escribe un motivo de al menos 12 caracteres para cada canto antes de revisarlo.')
  const result = await query(`?id=eq.${encodeURIComponent(row.id)}`, 'PATCH', { status: 'reviewed', reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
  if (result.length !== 1) throw new Error('No se pudo marcar como revisado.')
  return publicDraft(result[0])
}

export async function reviewedDrafts(): Promise<DraftRow[]> {
  const rows: DraftRow[] = []
  for (let offset = 0; ; offset += 200) {
    const page = await query(`?status=eq.reviewed&select=*&order=created_at.asc&limit=200&offset=${offset}`)
    rows.push(...page)
    if (page.length < 200) return rows
  }
}

type BatchRow = { id: string; status: DraftRow['status']; batch_scenario_id: string; model: string; provider: string }
export async function batchDrafts(): Promise<BatchRow[]> {
  const rows: BatchRow[] = []
  for (let offset = 0; ; offset += 100) {
    const page = await query(`?batch_scenario_id=not.is.null&select=id,status,batch_scenario_id,model:original->>model,provider:original->>provider&order=created_at.asc&limit=100&offset=${offset}`) as unknown as BatchRow[]
    rows.push(...page)
    if (page.length < 100) return rows
  }
}

function slim(song: Song) {
  return { id: song.id, title: song.title, evidence: (song.matched_section?.text || song.excerpt || '').slice(0, 300),
    energy: song.labels?.energia?.valor ?? song.match_labels?.energia?.valor ?? null,
    tags: song.match_labels?.temas || song.labels?.temas || {} }
}

export function trainingExample(row: DraftRow) {
  // La identidad del proveedor y del modelo es metadato operativo, nunca entrada de entrenamiento.
  const { provider: _provider, model: _model, ...request } = row.request
  const selected = row.curated.map(selection => {
    const item = row.original.items.find(candidate => candidate.key === selection.key)!
    return { stage: item.slot.title, songId: selection.songId, reason: selection.reason }
  })
  return { messages: [
      { role: 'system', content: 'Organiza cantos reales para un servicio. Devuelve JSON con una lista ordenada de canciones de los candidatos recibidos, sin repetir IDs. Respeta energía, tema, enfoque y ocasión.' },
      { role: 'user', content: JSON.stringify({ request, candidates: row.original.items.map(item => ({ key: item.key, stage: item.slot.title,
        targetEnergy: item.slot.targetEnergy, options: [item.song, ...item.alternatives].map(slim) })) }) },
      { role: 'assistant', content: JSON.stringify({ items: selected }) },
    ] }
}
