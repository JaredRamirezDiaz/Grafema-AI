import React from 'react'
import { createRoot } from 'react-dom/client'
import BatchApp from './BatchApp'
import './style.css'

createRoot(document.getElementById('root')!).render(<React.StrictMode><BatchApp /></React.StrictMode>)
