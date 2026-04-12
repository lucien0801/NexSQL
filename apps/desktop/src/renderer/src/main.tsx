import './workers'
import './styles/globals.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

// Use the locally Vite-bundled Monaco instead of CDN to avoid Electron CSP violations
loader.config({ monaco })

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
