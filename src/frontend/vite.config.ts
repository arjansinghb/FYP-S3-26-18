import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Matches the backend's default CORS_ORIGIN (see repo-root .env.example) —
    // change both together if you need a different port.
    port: 3000,
  },
})
