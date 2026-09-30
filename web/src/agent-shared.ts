export type Recipe = 'creciente' | 'descendente' | 'serena' | 'alta'
export type Recent = { id: string; token: string; theme: string; date: string; recipe?: Recipe; model?: string; provider?: string }
export const storageKey = 'grafema-ai-service-drafts-v1'
export const recipes: { key: Recipe; title: string; energies: number[] }[] = [
  { key: 'descendente', title: 'Del gozo a la calma', energies: [5, 4, 3, 2, 2] },
  { key: 'creciente', title: 'De la reflexión al gozo', energies: [2, 2, 3, 4, 5] },
  { key: 'serena', title: 'Adoración serena', energies: [2, 2, 2, 2, 2] },
  { key: 'alta', title: 'Siempre energía alta', energies: [5, 5, 5, 5, 5] },
]

export function savedServices(): Recent[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]')
    return Array.isArray(data) ? data as Recent[] : []
  } catch { return [] }
}

export function rememberService(entry: Omit<Recent, 'date'>): Recent[] {
  const next = [{ ...entry, date: new Date().toLocaleString('es-MX') },
    ...savedServices().filter(previous => previous.id !== entry.id)].slice(0, 120)
  localStorage.setItem(storageKey, JSON.stringify(next))
  return next
}
