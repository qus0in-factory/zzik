import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 앱 버전은 package.json에서 빌드 시 주입한다(하드코딩 금지). 타입은 src/globals.d.ts.
const appVersion = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version
// 이력 데이터 계층 기능 플래그(기본 꺼짐). `VITE_HISTORY_ENABLED=1 pnpm build`로 켠다.
const historyEnabled = ['1', 'true'].includes(process.env.VITE_HISTORY_ENABLED ?? '')

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion), __HISTORY_ENABLED__: JSON.stringify(historyEnabled) },
  plugins: [react(), tailwindcss()],
  resolve: { alias: { ...Object.fromEntries(['', 'ui', 'app', 'domain', 'infra'].map((layer) => [layer ? `@${layer}` : '@', fileURLToPath(new URL(`./src/${layer}`, import.meta.url))])), '@shared': fileURLToPath(new URL('./shared', import.meta.url)) } },
})
