import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// iOS reads the home-screen icon without the Access cookie. Inline it only in the built document.
export function inlineAppleTouchIcon(html: string, png: Buffer): string {
  const marker = 'href="/apple-touch-icon.png"'
  if (!html.includes(marker)) throw new Error('apple-touch-icon link is missing from index.html')
  return html.replace(marker, `href="data:image/png;base64,${png.toString('base64')}"`)
}

function inlineAppleTouchIconPlugin(): Plugin {
  return {
    name: 'inline-apple-touch-icon',
    apply: 'build',
    transformIndexHtml(html) {
      return inlineAppleTouchIcon(html, readFileSync(new URL('./public/apple-touch-icon.png', import.meta.url)))
    },
  }
}

// 앱 버전은 package.json에서 빌드 시 주입한다(하드코딩 금지). 타입은 src/globals.d.ts.
const appVersion = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version
// 이력 데이터 계층 기능 플래그(v0.6.3부터 기본 켜짐). 끄려면 `VITE_HISTORY_ENABLED=0`(또는 false)로 빌드한다. 타입은 src/globals.d.ts.
const historyEnabled = !['0', 'false'].includes(process.env.VITE_HISTORY_ENABLED ?? '')

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion), __HISTORY_ENABLED__: JSON.stringify(historyEnabled) },
  plugins: [react(), tailwindcss(), inlineAppleTouchIconPlugin()],
  resolve: { alias: { ...Object.fromEntries(['', 'ui', 'app', 'domain', 'infra'].map((layer) => [layer ? `@${layer}` : '@', fileURLToPath(new URL(`./src/${layer}`, import.meta.url))])), '@shared': fileURLToPath(new URL('./shared', import.meta.url)) } },
})
