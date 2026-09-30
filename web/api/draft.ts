import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminAuthorized, loadDraft, loadDraftAsAdmin, publicDraft, reviewDraft, updateDraft } from './_lib/drafts.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  const id = typeof req.query.id === 'string' ? req.query.id : ''
  const editToken = req.headers['x-edit-token']
  const admin = adminAuthorized(String(req.headers['x-dataset-admin-token'] || ''))
  if (!/^[a-f0-9-]{36}$/.test(id) || (typeof editToken !== 'string' && !admin)) return res.status(401).json({ error: 'Falta el acceso al borrador.' })
  try {
    const row = admin ? await loadDraftAsAdmin(id) : await loadDraft(id, String(editToken))
    if (!row) return res.status(404).json({ error: 'Borrador no encontrado.' })
    if (req.method === 'GET') return res.status(200).json(publicDraft(row))
    if (req.method === 'PATCH') {
      if (!Array.isArray(req.body?.selections)) return res.status(400).json({ error: 'Faltan las selecciones.' })
      const result = await updateDraft(row, req.body.selections)
      return res.status(200).json(result)
    }
    if (req.method === 'POST') {
      if (!admin) return res.status(403).json({ error: 'Necesitas el token de revisión del dataset.' })
      return res.status(200).json(await reviewDraft(row))
    }
    return res.status(405).json({ error: 'Método no admitido.' })
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'No se pudo guardar.' })
  }
}
