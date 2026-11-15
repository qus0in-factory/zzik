import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { inlineAppleTouchIcon } from '../../vite.config'

function links(html: string) {
  return [...html.matchAll(/<link\b[^>]*>/g)].map((match) => {
    const attr = (name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(match[0])?.[1]
    return { rel: attr('rel'), type: attr('type'), sizes: attr('sizes'), href: attr('href'), crossorigin: attr('crossorigin') }
  })
}

describe('Given index.html built for a site behind Cloudflare Access', () => {
  it('When the apple touch icon is inlined Then the link is the public PNG and the other icon links stay paths', () => {
    const source = readFileSync('index.html', 'utf8')
    const png = readFileSync('public/apple-touch-icon.png')
    const html = inlineAppleTouchIcon(source, png)
    expect(source).toContain('href="/apple-touch-icon.png"')
    const found = links(html)
    const apple = found.find((link) => link.rel === 'apple-touch-icon' && link.sizes === '180x180')?.href ?? ''
    expect(apple.startsWith('data:image/png;base64,')).toBe(true)
    expect(Buffer.from(apple.slice('data:image/png;base64,'.length), 'base64').equals(png)).toBe(true)
    expect(found).toEqual(expect.arrayContaining([
      expect.objectContaining({ rel: 'icon', type: 'image/png', sizes: '96x96', href: '/favicon-96x96.png' }),
      expect.objectContaining({ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }),
      expect.objectContaining({ rel: 'shortcut icon', href: '/favicon.ico' }),
      expect.objectContaining({ rel: 'manifest', href: '/site.webmanifest', crossorigin: 'use-credentials' }),
    ]))
  })
})
