import { config } from 'dotenv'
import { createServer } from 'node:http'
import handler from '../api/service.js'
import draftHandler from '../api/draft.js'
import datasetHandler from '../api/dataset.js'
import batchHandler from '../api/batch.js'

// Vite suele usar .env.local; el proceso Node del agente necesita cargarlo explícitamente.
config({ path: '.env.local' })
config({ path: '.env' })
const port = Number(process.env.AGENT_PORT || 8787)
createServer(async (request, response) => {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  let body: unknown
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { body = null }
  const url = new URL(request.url || '/', 'http://localhost')
  const res = Object.assign(response, {
    status(code: number) { response.statusCode = code; return res },
    json(value: unknown) { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)); return res },
    send(value: string) { response.end(value); return res },
  })
  const req = Object.assign(request, { body, query: Object.fromEntries(url.searchParams) }) as never
  const route = url.pathname === '/api/draft' ? draftHandler : url.pathname === '/api/dataset' ? datasetHandler : url.pathname === '/api/batch' ? batchHandler : handler
  await route(req, res as never)
}).listen(port, () => console.log(`Agente local escuchando en http://localhost:${port}`))
