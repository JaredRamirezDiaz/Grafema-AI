const agentBaseUrl = (import.meta.env.VITE_AGENT_URL || '').replace(/\/$/, '')

export function agentApiUrl(path: `/api/${string}`) {
  return `${agentBaseUrl}${path}`
}
