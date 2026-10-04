import { cva } from 'class-variance-authority'
import { ExternalLink, Info, Search, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'

const navItem = cva('nav-rail-link', { variants: { active: { true: 'is-active', false: '' } } })
const destinations = [
  { href: '/', label: 'Búsqueda semántica (RAG)', icon: Search, match: (path: string) => path === '/' || path.endsWith('/index.html'), visible: true },
  { href: '/agente.html', label: 'Agente IA (Fine-tuning)', icon: Sparkles, match: (path: string) => path.endsWith('/agente.html'), visible: true},
  { href: '/informacion.html', label: 'Conocer el proyecto', icon: Info, match: (path: string) => path.endsWith('/informacion.html'), visible: false },
]

function GitHubIcon({ 'aria-hidden': ariaHidden }: { 'aria-hidden'?: boolean | 'true' | 'false' }) {
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden={ariaHidden}>
    <path d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.52-1.34-1.28-1.7-1.28-1.7-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.57-.29-5.27-1.28-5.27-5.68 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.47.11-3.05 0 0 .97-.31 3.16 1.18a10.97 10.97 0 0 1 5.75 0c2.2-1.49 3.16-1.18 3.16-1.18.63 1.58.23 2.76.12 3.05.73.81 1.17 1.83 1.17 3.09 0 4.41-2.7 5.38-5.28 5.67.42.36.78 1.06.78 2.14v3.18c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" />
  </svg>
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = window.location.pathname
  return <TooltipProvider delayDuration={150}>
    <aside className="nav-rail" aria-label="Navegación principal">
      <a className="nav-rail-brand" href="/" aria-label="Grafema AI, inicio">
        <img className="nav-rail-brand-logo" src="/assets/grafema-light.svg" alt="Grafema AI" />
      </a>
      <nav>{destinations.map(({ href, label, icon: Icon, match, visible }) => {
        if (!visible) return null
        return <Tooltip key={href}>
          <TooltipTrigger asChild><a href={href} className={cn(navItem({ active: match(path) }))} aria-current={match(path) ? 'page' : undefined}>
            <Icon aria-hidden="true" /><span>{label}</span>
          </a></TooltipTrigger><TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>
      })}</nav>
      <div className="nav-rail-external" aria-label="Enlaces externos">
        <a className="nav-rail-course" href="https://github.com/JaredRamirezDiaz/Grafema-AI" target="_blank" rel="noreferrer" aria-label="Ver el código en GitHub">
          <GitHubIcon aria-hidden="true" /><span>GitHub</span>
        </a>
      </div>
    </aside>
    <div className="app-shell-content">{children}</div>
  </TooltipProvider>
}
