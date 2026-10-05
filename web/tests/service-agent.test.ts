import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assemble, buildSlots, requestSchema, shortlist, type Song } from '../api/_lib/service-agent.js'
import { availableModels, validateModel } from '../api/_lib/models.js'
import { hashToken, sameToken, saveDraft, trainingExample, validateSelections, type DraftRow } from '../api/_lib/drafts.js'
import { batchTarget, scenarios } from '../api/_lib/batch-scenarios.js'
import { searchCatalog } from '../api/service.js'

const input = requestSchema.parse({ theme: 'Esperanza', recipe: 'descendente', count: 3 })
const song = (id: string, score: number, energy: number): Song => ({ id, title: id, lyrics: 'Letra', excerpt: 'Letra', score, labels: { energia: { valor: energy } } })

test('reintenta la búsqueda cuando Render responde 502 mientras despierta', async () => {
  const previousUrl = process.env.GRAFEMA_API_URL
  const previousFetch = globalThis.fetch
  const events: string[] = []
  let attempts = 0
  process.env.GRAFEMA_API_URL = 'https://search.example'
  globalThis.fetch = (async () => {
    attempts += 1
    if (attempts === 1) return new Response('', { status: 502 })
    return new Response(JSON.stringify({ results: [song('recuperada', .9, 3)] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
  try {
    const results = await searchCatalog('esperanza', event => events.push(event.type), [0])
    assert.equal(attempts, 2)
    assert.deepEqual(events, ['waiting'])
    assert.equal(results[0]?.id, 'recuperada')
  } finally {
    globalThis.fetch = previousFetch
    if (previousUrl === undefined) delete process.env.GRAFEMA_API_URL
    else process.env.GRAFEMA_API_URL = previousUrl
  }
})

test('las recetas distribuyen energía y conservan apertura y cierre', () => {
  const slots = buildSlots(input)
  assert.deepEqual(slots.map(slot => slot.title), ['Apertura', 'Respuesta', 'Cierre'])
  assert.deepEqual(slots.map(slot => slot.targetEnergy), [5, 3, 2])
})

test('la receta de energía alta se mantiene en todas las etapas', () => {
  const slots = buildSlots(requestSchema.parse({ theme: 'Gratitud', recipe: 'alta', count: 9 }))
  assert.deepEqual(slots.map(slot => slot.targetEnergy), [5, 5, 5, 5, 5])
})

test('las 100 solicitudes tienen IDs estables, cuatro recetas y objetivo inicial de 70', () => {
  assert.equal(scenarios.length, 100)
  assert.equal(new Set(scenarios.map(scenario => scenario.id)).size, 100)
  assert.equal(new Set(scenarios.map(scenario => JSON.stringify(scenario.request))).size, 100)
  assert.deepEqual(new Set(scenarios.map(scenario => scenario.request.recipe)), new Set(['descendente', 'creciente', 'serena', 'alta']))
  assert.equal(batchTarget(), 70)
})

test('ordena alternativas según cercanía de energía y coincidencia', () => {
  const sorted = shortlist([song('alta', .70, 5), song('suave', .71, 2)], 2)
  assert.equal(sorted[0].id, 'suave')
})

test('descarta elecciones inventadas y repetidas; evita repetir un canto entre momentos', () => {
  const slots = buildSlots(input)
  const pools = new Map([
    ['s1', [song('a', .9, 5)]],
    ['s2', [song('a', .9, 3), song('b', .8, 3)]],
    ['s3', [song('c', .9, 2)]],
  ])
  const items = assemble(slots, pools, [
    { slotKey: 's1', id: 'a', reason: 'Esta letra corresponde a la apertura.' },
    { slotKey: 's2', id: 'a', reason: 'El modelo eligió el mismo canto.' },
    { slotKey: 's3', id: 'fantasma', reason: 'Un título inexistente.' },
  ], 3)
  assert.deepEqual(items.map(item => item.song.id), ['a', 'b', 'c'])
  assert.match(items[2].reason, /revisa su letra/i)
})

test('nueve cantos pueden repartirse en cinco momentos, varios en la misma búsqueda', () => {
  const slots = buildSlots(requestSchema.parse({ theme: 'Esperanza', recipe: 'creciente', count: 9 }))
  assert.equal(slots.length, 5)
  const pools = new Map(slots.map((slot, i) => [slot.key, Array.from({ length: 3 }, (_, j) => song(`${i}-${j}`, .8 - j * .03, i + 1))] as const))
  const choices = slots.flatMap((slot, i) => [
    { slotKey: slot.key, id: `${i}-0`, reason: 'Letra relacionada con la esperanza.' },
    { slotKey: slot.key, id: `${i}-1`, reason: 'Segunda letra adecuada para esta etapa.' },
  ])
  const items = assemble(slots, pools, choices, 9)
  assert.equal(items.length, 9)
  assert.equal(new Set(items.map(item => item.song.id)).size, 9)
  assert.ok(slots.some(slot => items.filter(item => item.slot.key === slot.key).length > 1))
})

test('las correcciones solo aceptan IDs recuperados y exportan la selección humana', () => {
  const slot = buildSlots(input)[0]
  const first = song('original', .9, 5), alternate = song('humano', .8, 4)
  const row = { id: 'abc', request: input, edit_token_hash: hashToken('secret'), status: 'reviewed',
    original: { model: 'modelo', provider: 'openrouter', searches: [], items: [{ key: 's1-1', slot, song: first,
      reason: 'Motivo original del agente.', alternatives: [alternate] }] },
    curated: [{ key: 's1-1', songId: 'humano', reason: 'El coro se ajusta a este servicio.' }],
    created_at: '2026-09-26T00:00:00Z', reviewed_at: '2026-09-26T00:00:00Z' } as DraftRow
  assert.ok(sameToken('secret', row.edit_token_hash))
  assert.throws(() => validateSelections(row, [{ key: 's1-1', songId: 'inventado', reason: 'Motivo' }]), /inválido/)
  const output = trainingExample(row).messages[2].content
  assert.equal(JSON.parse(output).items[0].songId, 'humano')
  const trainingRequest = JSON.parse(trainingExample(row).messages[1].content).request
  assert.equal(trainingRequest.provider, undefined)
  assert.equal(trainingRequest.model, undefined)
})

test('al generar se guarda el borrador original y una selección inicial separada', async () => {
  const priorFetch = global.fetch, priorUrl = process.env.SUPABASE_URL, priorKey = process.env.SUPABASE_SECRET_KEY
  const slot = buildSlots(input)[0]
  const plan = { provider: 'openrouter', model: 'modelo', searches: [], items: [{ key: 's1-1', slot, song: song('canto', .8, 5),
    reason: 'La letra corresponde al tema.', alternatives: [song('otro', .7, 4)] }] }
  try {
    process.env.SUPABASE_URL = 'https://ejemplo.supabase.co'; process.env.SUPABASE_SECRET_KEY = 'test-only'
    global.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as DraftRow
      assert.equal(body.original.items[0].song.id, 'canto')
      assert.equal(body.curated[0].songId, 'canto')
      assert.equal(body.status, undefined)
      assert.match(body.edit_token_hash, /^[a-f0-9]{64}$/)
      return Response.json([body])
    }
    const saved = await saveDraft(input, plan)
    assert.equal(saved.status, 'draft')
    assert.match(saved.editToken, /^[a-f0-9]{64}$/)
  } finally {
    global.fetch = priorFetch
    if (priorUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = priorUrl
    if (priorKey === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = priorKey
  }
})

test('muestra OpenRouter al configurar clave y rechaza modelos fuera de la lista', () => {
  const originalKey = process.env.OPENROUTER_API_KEY
  const originalModels = process.env.AGENT_OPENROUTER_MODELS
  try {
    process.env.OPENROUTER_API_KEY = 'test-only'
    process.env.AGENT_OPENROUTER_MODELS = 'meta-llama/llama-3.3-70b-instruct,google/gemini-2.5-flash'
    assert.equal(availableModels().find(item => item.id === 'openrouter')?.models.length, 2)
    assert.equal(validateModel('openrouter', 'google/gemini-2.5-flash'), 'google/gemini-2.5-flash')
    assert.throws(() => validateModel('openrouter', 'otro/modelo'), /no disponible/)
  } finally {
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY
    else process.env.OPENROUTER_API_KEY = originalKey
    if (originalModels === undefined) delete process.env.AGENT_OPENROUTER_MODELS
    else process.env.AGENT_OPENROUTER_MODELS = originalModels
  }
})
