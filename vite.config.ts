import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: Object.fromEntries(['', 'ui', 'app', 'domain', 'infra'].map((layer) => [layer ? `@${layer}` : '@', fileURLToPath(new URL(`./src/${layer}`, import.meta.url))])) },
})
