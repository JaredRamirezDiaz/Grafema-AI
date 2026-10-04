import { ArrowRight, BookOpenText, BrainCircuit, Church, Database, Search, Sparkles } from 'lucide-react'
import { AppShell } from './components/app-shell'

const stages = [
  { icon: Database, title: 'Catálogo estructurado', text: 'Cantos, letras, secciones y etiquetas forman la fuente de conocimiento del proyecto.' },
  { icon: Search, title: 'Recuperación semántica', text: 'BGE-M3 convierte la consulta en un vector y recupera contenido por significado, no solo por palabras exactas.' },
  { icon: BrainCircuit, title: 'Asistencia con Llama', text: 'Un modelo abierto razona únicamente sobre candidatos recuperados y explica una propuesta verificable.' },
]

export default function InfoApp() {
  return <AppShell><main className="info-page">
    <section className="info-hero"><span className="eyebrow">CONTEXTO DEL PROYECTO · HACKATHON DEV.F + META</span>
      <h1>IA aplicada a una necesidad<br /><em>real de una comunidad.</em></h1>
      <p>Grafema AI es una prueba de concepto creada para un curso de IA aplicada con Llama. Explora cómo la búsqueda semántica, RAG y los modelos abiertos pueden ayudar a encontrar y organizar cantos dentro del contexto de una iglesia cristiana.</p>
      <div className="info-actions"><a className="primary-action" href="/">Probar el buscador <ArrowRight /></a><a href="/agente.html">Conocer el agente</a></div>
    </section>

    <section className="context-grid"><article className="context-card featured"><Church /><span className="section-kicker">EL CONTEXTO</span><h2>¿Qué significa “servicio”?</h2><p>En este proyecto, un servicio o culto es una reunión de una iglesia cristiana. La música acompaña distintos momentos —apertura, reflexión, respuesta o cierre— y cada canto debe ser coherente con el mensaje, el tono y la comunidad.</p></article>
      <article className="context-card"><BookOpenText /><span className="section-kicker">EL PROBLEMA</span><h2>Buscar por significado</h2><p>Un catálogo puede contener cientos de letras. Recordar títulos o buscar una palabra exacta no basta cuando alguien necesita “un canto de esperanza para un momento difícil”. Grafema AI busca por intención y contenido.</p></article>
      <article className="context-card"><Sparkles /><span className="section-kicker">LA UTILIDAD</span><h2>Reducir tiempo, conservar criterio</h2><p>La IA propone candidatos y explica coincidencias. No reemplaza a quien dirige la música: hace visible información relevante para que una persona tome una decisión mejor informada.</p></article>
    </section>

    <section className="how-section"><div><span className="section-kicker">DEMOSTRACIÓN TÉCNICA</span><h2>Cómo funciona</h2><p>La demo conecta un frontend público con servicios independientes de búsqueda y generación. Esta separación permite probar el pipeline completo y reutilizarlo más adelante.</p></div><div className="stage-list">{stages.map(({ icon: Icon, title, text }, index) => <article key={title}><span>{String(index + 1).padStart(2, '0')}</span><Icon /><div><h3>{title}</h3><p>{text}</p></div></article>)}</div></section>

    <section className="future-section"><span className="section-kicker">DEL CURSO AL PRODUCTO REAL</span><h2>Implementación futura en Grafema Presenter</h2><div className="future-grid"><div><strong>Hoy · prueba de concepto</strong><p>Catálogo de demostración, búsqueda semántica, evidencia por letra y un agente que propone repertorios.</p></div><div><strong>Siguiente etapa · validación humana</strong><p>Evaluación con personas que conocen el dominio, revisión de propuestas y medición de calidad con consultas reales.</p></div><div><strong>Futuro · integración responsable</strong><p>Incorporación opcional dentro de Grafema Presenter, con permisos, trazabilidad y decisiones finales siempre en manos del usuario.</p></div></div></section>
  </main><footer><span>Grafema AI · Proyecto académico con aplicación real</span></footer></AppShell>
}
