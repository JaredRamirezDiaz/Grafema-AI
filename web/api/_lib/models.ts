export type ProviderId = 'cloudflare' | 'openrouter'
export type ModelOption = { id: string; label: string }
export type ProviderOption = { id: ProviderId; label: string; models: ModelOption[] }

const cloudflareDefault = '@cf/meta/llama-4-scout-17b-16e-instruct'
const openrouterDefaults = 'meta-llama/llama-3.3-70b-instruct,google/gemini-2.5-flash'

function parseModels(value: string): ModelOption[] {
  return [...new Set(value.split(',').map(model => model.trim()).filter(model => /^[a-zA-Z0-9@][a-zA-Z0-9@._:/+-]{1,159}$/.test(model)))].slice(0, 20)
    .map(id => ({ id, label: id }))
}

export function availableModels(): ProviderOption[] {
  const providers: ProviderOption[] = []
  if (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN) {
    providers.push({ id: 'cloudflare', label: 'Cloudflare Workers AI',
      models: parseModels(process.env.AGENT_CLOUDFLARE_MODELS || process.env.AGENT_MODEL || cloudflareDefault) })
  }
  if (process.env.OPENROUTER_API_KEY) {
    providers.push({ id: 'openrouter', label: 'OpenRouter',
      models: parseModels(process.env.AGENT_OPENROUTER_MODELS || openrouterDefaults) })
  }
  return providers
}

export function validateModel(provider: ProviderId, requested?: string) {
  const entry = availableModels().find(item => item.id === provider)
  const selected = requested || entry?.models[0]?.id
  if (!entry || !selected || !entry.models.some(model => model.id === selected)) {
    throw new Error(`Modelo de ${provider} no disponible. Revisa la clave y la lista de modelos en web/.env.`)
  }
  return selected
}
