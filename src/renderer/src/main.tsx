import React from 'react'
import ReactDOM from 'react-dom/client'
// First, so <html lang> is right before anything renders.
import './lib/i18n'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './styles/index.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
