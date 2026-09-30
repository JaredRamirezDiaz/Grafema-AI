import { requestSchema, type ServiceRequest } from './service-agent.js'

// Catálogo versionado: no reordenar entradas ya publicadas, sus IDs viven en Supabase.
const topics = [
  { theme: 'Gratitud por la fidelidad de Dios', occasion: 'Culto dominical' },
  { theme: 'Esperanza en medio de las dificultades', occasion: 'Culto de oración' },
  { theme: 'El amor y la gracia de Cristo', occasion: 'Culto dominical' },
  { theme: 'La segunda venida de Jesús', occasion: 'Culto de esperanza' },
  { theme: 'Perdón y restauración', occasion: 'Culto de oración' },
  { theme: 'La resurrección y la vida nueva', occasion: 'Celebración de Pascua' },
  { theme: 'Jesús, luz del mundo', occasion: 'Celebración de Navidad' },
  { theme: 'Consagración y entrega a Dios', occasion: 'Culto de consagración' },
  { theme: 'La presencia del Espíritu Santo', occasion: 'Culto de oración' },
  { theme: 'La iglesia como cuerpo de Cristo', occasion: 'Aniversario de la iglesia' },
  { theme: 'Fe para confiar en las promesas de Dios', occasion: 'Culto dominical' },
  { theme: 'Jesús como Salvador y Redentor', occasion: 'Culto evangelístico' },
  { theme: 'Unidad y amor fraternal', occasion: 'Reunión de la iglesia' },
  { theme: 'La santidad y el carácter de Dios', occasion: 'Culto de adoración' },
  { theme: 'Dios como refugio y fortaleza', occasion: 'Culto de oración' },
  { theme: 'El gozo de la salvación', occasion: 'Celebración de bautismos' },
  { theme: 'Recordar el sacrificio de Jesús', occasion: 'Santa Cena' },
  { theme: 'Llamado a compartir el evangelio', occasion: 'Culto misionero' },
  { theme: 'Dios guía a las familias', occasion: 'Culto familiar' },
  { theme: 'Alabanza por la victoria de Cristo', occasion: 'Culto de jóvenes' },
] as const

const settings = [
  { focus: 'Alabanza congregacional', notes: 'Dar espacio a la participación de toda la iglesia.', count: 7 },
  { focus: 'Oración y respuesta personal', notes: 'Dejar un momento claro para responder en oración.', count: 6 },
  { focus: 'Enseñanza bíblica y reflexión', notes: 'Conectar la letra de los cantos con el mensaje central.', count: 8 },
  { focus: 'Invitación y compromiso', notes: 'Concluir con un llamado concreto para la congregación.', count: 5 },
  { focus: 'Celebración comunitaria', notes: 'Priorizar cantos que pueda cantar toda la congregación.', count: 9 },
] as const

const recipes = ['descendente', 'creciente', 'serena', 'alta'] as const
export type Scenario = { id: string; request: Omit<ServiceRequest, 'provider' | 'model'> }
export const scenarios: Scenario[] = topics.flatMap((topic, topicIndex) => settings.map((setting, settingIndex) => ({
  id: `v1-${String(topicIndex * settings.length + settingIndex + 1).padStart(3, '0')}`,
  request: requestSchema.omit({ provider: true, model: true }).parse({
    theme: topic.theme, specialOccasion: topic.occasion, ...setting,
    recipe: recipes[(topicIndex + settingIndex) % recipes.length],
  }),
})))

export function batchTarget() {
  const value = Number(process.env.SERVICE_BATCH_TARGET || '70')
  return Number.isInteger(value) && value >= 1 && value <= 100 ? value : 70
}

export function batchEnabled() { return process.env.SERVICE_BATCH_ENABLED === 'true' }
