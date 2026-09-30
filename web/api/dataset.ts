import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminAuthorized, reviewedDrafts, trainingExample } from './_lib/drafts.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no admitido.' })
  if (!adminAuthorized(String(req.headers['x-dataset-admin-token'] || ''))) return res.status(403).json({ error: 'Token de revisión incorrecto.' })
  try {
    const rows = await reviewedDrafts()
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="grafema-services-reviewed.jsonl"')
    return res.status(200).send(rows.map(row => JSON.stringify(trainingExample(row))).join('\n') + (rows.length ? '\n' : ''))
  } catch (error) {
    console.error('Exportación del dataset:', error)
    return res.status(502).json({ error: 'No se pudo exportar el dataset.' })
  }
}
