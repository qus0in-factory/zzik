import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 이력 데이터 계층 기능 플래그(기본 꺼짐). `VITE_HISTORY_ENABLED=1 pnpm build`로 켠다. 타입은 src/globals.d.ts.
const historyEnabled = ['1', 'true'].includes(process.env.VITE_HISTORY_ENABLED ?? '')

export default defineConfig({
  define: { __HISTORY_ENABLED__: JSON.stringify(historyEnabled) },
  plugins: [react(), tailwindcss()],
  resolve: { alias: Object.fromEntries(['', 'ui', 'app', 'domain', 'infra'].map((layer) => [layer ? `@${layer}` : '@', fileURLToPath(new URL(`./src/${layer}`, import.meta.url))])) },
})
