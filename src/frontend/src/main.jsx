import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Dismiss the static boot splash (index.html) now that React has actually
// mounted. A short fixed minimum-display beat, not "as fast as possible" —
// removing it instantly on a fast load makes it flash on and off, which
// reads as a glitch rather than a loading moment.
const bootSplash = document.getElementById('boot-splash')
if (bootSplash) {
  setTimeout(() => {
    bootSplash.classList.add('boot-splash-hidden')
    setTimeout(() => bootSplash.remove(), 400)
  }, 260)
}

// UV07 — Install the Application (PWA). Registered only in production
// builds: Vite's dev server serves modules in a way that confuses a service
// worker's fetch interception, so this deliberately skips `npm run dev`.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* installability is a nice-to-have, not load-bearing */ })
  })
}
