import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { inlineAppleTouchIcon, inlineAppleTouchIconPlugin } from '../../vite.config'

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
  it('When the link attributes are reordered Then the link tag is still inlined in place', () => {
    const source = '<link href="/apple-touch-icon.png" sizes="180x180" rel="apple-touch-icon" />'
    const png = readFileSync('public/apple-touch-icon.png')
    const html = inlineAppleTouchIcon(source, png)
    expect(links(html)).toEqual([{ rel: 'apple-touch-icon', type: undefined, sizes: '180x180', href: `data:image/png;base64,${png.toString('base64')}`, crossorigin: undefined }])
  })
  it('When the marker text appears outside a link tag Then only the apple touch icon link is replaced', () => {
    const source = [
      '<!-- href="/apple-touch-icon.png" -->',
      '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />',
    ].join('\n')
    const png = readFileSync('public/apple-touch-icon.png')
    const html = inlineAppleTouchIcon(source, png)
    expect(html.split('\n')[0]).toBe('<!-- href="/apple-touch-icon.png" -->')
    expect(links(html)[0].href).toBe(`data:image/png;base64,${png.toString('base64')}`)
  })
  it('When index.html lacks the apple touch icon link Then inlining throws', () => {
    const source = readFileSync('index.html', 'utf8').replace(/<link rel="apple-touch-icon"[^>]*>/, '')
    const png = readFileSync('public/apple-touch-icon.png')
    expect(source).not.toContain('rel="apple-touch-icon"')
    expect(() => inlineAppleTouchIcon(source, png)).toThrow(/apple-touch-icon/)
  })
})

describe('Given the apple touch icon Vite plugin', () => {
  it('When the plugin is registered Then it only runs for builds and exposes the index transform', () => {
    const plugin = inlineAppleTouchIconPlugin()
    expect(plugin.name).toBe('inline-apple-touch-icon')
    expect(plugin.apply).toBe('build')
    expect(typeof plugin.transformIndexHtml).toBe('function')
  })
  it('When the build transform runs on the real index.html Then the public icon is inlined', () => {
    const plugin = inlineAppleTouchIconPlugin()
    const transform = plugin.transformIndexHtml as unknown as (html: string) => string
    const png = readFileSync('public/apple-touch-icon.png')
    const apple = links(transform(readFileSync('index.html', 'utf8'))).find((link) => link.rel === 'apple-touch-icon')
    expect(apple?.href).toBe(`data:image/png;base64,${png.toString('base64')}`)
  })
})
