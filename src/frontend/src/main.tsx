import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// UV07 — Install the Application (PWA). Registered after load so it never
// competes with the initial page render for bandwidth/priority. Only in
// production builds + secure contexts — `npm run dev` skips this so a
// stale cached service worker never fights Vite's dev server / HMR.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Installability is a progressive enhancement — a failed registration
      // shouldn't be user-visible or block the app from working normally.
    })
  })
}
