// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const pngSizes = { 'favicon-96x96.png': 96, 'apple-touch-icon.png': 180, 'web-app-manifest-192x192.png': 192, 'web-app-manifest-512x512.png': 512 }

describe('Given the Zzik favicon set behind Cloudflare Access', () => {
  it('When the head is parsed Then all platform tags point at existing assets and the manifest sends credentials', () => {
    const document = new DOMParser().parseFromString(readFileSync('index.html', 'utf8'), 'text/html')
    for (const [selector, path] of [
      ['link[rel="icon"][type="image/png"][sizes="96x96"]', '/favicon-96x96.png'],
      ['link[rel="icon"][type="image/svg+xml"]', '/favicon.svg'],
      ['link[rel="shortcut icon"]', '/favicon.ico'],
      ['link[rel="apple-touch-icon"][sizes="180x180"]', '/apple-touch-icon.png'],
      ['link[rel="manifest"][crossorigin="use-credentials"]', '/site.webmanifest'],
    ]) {
      expect(document.querySelector(selector)?.getAttribute('href')).toBe(path)
      expect(existsSync(`public${path}`)).toBe(true)
    }
    expect(document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute('content')).toBe('Zzik')
    for (const scheme of ['light', 'dark']) expect(document.querySelector(`meta[name="theme-color"][media="(prefers-color-scheme: ${scheme})"]`)?.getAttribute('content')).toMatch(/^#[0-9a-f]{6}$/i)
  })
  it('When PNG headers are read Then every platform gets its actual required dimensions', () => {
    for (const [file, size] of Object.entries(pngSizes)) {
      const png = readFileSync(`public/${file}`)
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      expect(png.toString('ascii', 12, 16)).toBe('IHDR')
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([size, size])
    }
  })
  it('When the ICO directory is decoded Then 16, 32 and 48 pixel entries contain matching PNGs', () => {
    const ico = readFileSync('public/favicon.ico')
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([0, 1, 3])
    for (const [i, size] of [16, 32, 48].entries()) {
      const entry = 6 + 16 * i
      expect([ico[entry], ico[entry + 1], ico.readUInt16LE(entry + 6)]).toEqual([size, size, 32])
      const offset = ico.readUInt32LE(entry + 12)
      const length = ico.readUInt32LE(entry + 8)
      expect(offset + length).toBeLessThanOrEqual(ico.length)
      const png = ico.subarray(offset, offset + length)
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([size, size])
    }
  })
  it('When the manifest is loaded Then install metadata and any/maskable paths agree with PNG files', () => {
    const manifest = JSON.parse(readFileSync('public/site.webmanifest', 'utf8'))
    expect(manifest).toMatchObject({ name: 'Zzik : AI 사용량 대시보드', short_name: 'Zzik', theme_color: '#057873', background_color: '#057873', display: 'standalone', start_url: '/' })
    expect(manifest.icons).toHaveLength(2)
    for (const [i, size] of [192, 512].entries()) {
      expect(manifest.icons[i]).toEqual({ src: `/web-app-manifest-${size}x${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any maskable' })
      expect(existsSync(`public${manifest.icons[i].src}`)).toBe(true)
    }
  })
  it('When legacy assets are retired Then old files and head references are absent', () => {
    for (const file of ['favicon-32.png', 'icon-192.png']) {
      expect(existsSync(`public/${file}`)).toBe(false)
      expect(readFileSync('index.html', 'utf8')).not.toContain(file)
    }
  })
})
