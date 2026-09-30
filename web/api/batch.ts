import type { VercelRequest, VercelResponse } from '@vercel/node'
import { batchDrafts, adminAuthorized, saveDraft } from './_lib/drafts.js'
import { batchEnabled, batchTarget, scenarios } from './_lib/batch-scenarios.js'
import { createService, requestSchema } from './_lib/service-agent.js'
import { searchCatalog } from './service.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (!batchEnabled()) return res.status(404).json({ error: 'Generación por lotes desactivada en el servidor.' })
  if (!adminAuthorized(String(req.headers['x-dataset-admin-token'] || '')))
    return res.status(403).json({ error: 'Se necesita el DATASET_ADMIN_TOKEN para generar lotes.' })
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Método no admitido.' })
  try {
    const rows = await batchDrafts()
    const existing = new Map(rows.map(row => [row.batch_scenario_id, row]))
    if (req.method === 'GET') return res.status(200).json({ target: batchTarget(), total: scenarios.length,
      scenarios: scenarios.map((scenario, i) => ({ ...scenario, enabled: i < batchTarget(),
        saved: existing.has(scenario.id) ? { id: existing.get(scenario.id)!.id,
          status: existing.get(scenario.id)!.status, model: existing.get(scenario.id)!.model,
          provider: existing.get(scenario.id)!.provider } : null })) })

    const scenario = scenarios.slice(0, batchTarget()).find(entry => entry.id === req.body?.scenarioId)
    if (!scenario) return res.status(400).json({ error: 'Solicitud no habilitada en este lote.' })
    const previous = existing.get(scenario.id)
    if (previous) return res.status(409).json({ error: 'Esta solicitud ya tiene un servicio guardado. Actualiza la lista.' })
    // Se ignora cualquier preferencia de usuario distinta de un proveedor/modelo de la lista permitida.
    const parsed = requestSchema.safeParse({ ...scenario.request, provider: req.body?.provider, model: req.body?.model })
    if (!parsed.success) return res.status(400).json({ error: 'Proveedor o modelo inválido.' })
    const plan = await createService(parsed.data, searchCatalog)
    if (plan.items.length !== parsed.data.count || plan.missingSlots.length)
      return res.status(422).json({ error: 'El agente no encontró suficientes cantos; este escenario queda pendiente para reintentar.' })
    const draft = await saveDraft(parsed.data, plan, scenario.id)
    return res.status(201).json({ scenarioId: scenario.id, theme: plan.theme, recipe: plan.recipe,
      model: plan.model, provider: plan.provider, draft })
  } catch (error) {
    console.error('Lote de servicios:', error instanceof Error ? error.message : error)
    return res.status(502).json({ error: 'No se pudo generar o guardar el servicio. Revisa los registros del agente y la migración 004; el escenario pendiente puede reintentarse.' })
  }
}
