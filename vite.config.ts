import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// iOS reads the home-screen icon without the Access cookie. Inline it only in the built document.
// Match the whole link tag so a stray href in a comment or meta tag can never be rewritten.
const appleTouchIconLink = /<link\b(?=[^>]*\brel="apple-touch-icon")(?=[^>]*\bhref="\/apple-touch-icon\.png")[^>]*>/

export function inlineAppleTouchIcon(html: string, png: Buffer): string {
  const link = appleTouchIconLink.exec(html)
  if (!link) throw new Error('apple-touch-icon link is missing from index.html')
  const inlined = link[0].replace('href="/apple-touch-icon.png"', `href="data:image/png;base64,${png.toString('base64')}"`)
  return html.slice(0, link.index) + inlined + html.slice(link.index + link[0].length)
}

export function inlineAppleTouchIconPlugin(): Plugin {
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
