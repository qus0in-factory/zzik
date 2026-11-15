// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

const pngSizes = {
  'favicon-96x96.png': 96,
  'apple-touch-icon.png': 180,
  'android-chrome-192x192.png': 192,
  'android-chrome-512x512.png': 512,
  'web-app-manifest-192x192.png': 192,
  'web-app-manifest-512x512.png': 512,
}

/** Decode a non-interlaced 8-bit RGB or RGBA PNG. Returns the alpha of the four corners. */
function cornerAlphas(png: Buffer): number[] {
  let offset = 8
  let width = 0
  let height = 0
  let colorType = 0
  const idat: Buffer[] = []
  while (offset < png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.toString('ascii', offset + 4, offset + 8)
    const data = png.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      if (data[8] !== 8 || data[10] !== 0 || data[11] !== 0) throw new Error('PNG must be 8-bit, non-interlaced')
      colorType = data[9]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    offset += 12 + length
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
  if (!channels) throw new Error(`unsupported PNG color type ${colorType}`)
  const inflated = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const pixels = Buffer.alloc(height * stride)
  let src = 0
  for (let y = 0; y < height; y++) {
    const filter = inflated[src++]
    const row = y * stride
    const up = y > 0 ? pixels.subarray(row - stride, row) : null
    for (let x = 0; x < stride; x++) {
      const raw = inflated[src++]
      const left = x >= channels ? pixels[row + x - channels] : 0
      const above = up ? up[x] : 0
      const upperLeft = up && x >= channels ? up[x - channels] : 0
      let value = raw
      if (filter === 1) value = (raw + left) & 255
      else if (filter === 2) value = (raw + above) & 255
      else if (filter === 3) value = (raw + Math.floor((left + above) / 2)) & 255
      else if (filter === 4) {
        const paeth = left + above - upperLeft
        const nearest = [left, above, upperLeft].reduce((best, candidate) => Math.abs(paeth - candidate) < Math.abs(paeth - best) ? candidate : best)
        value = (raw + nearest) & 255
      } else if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}`)
      pixels[row + x] = value
    }
  }
  const alpha = (x: number, y: number) => channels === 3 ? 255 : pixels[(y * width + x) * channels + 3]
  return [alpha(0, 0), alpha(width - 1, 0), alpha(0, height - 1), alpha(width - 1, height - 1)]
}

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
    const icon = (file: string, size: number, purpose: string) => ({ src: `/${file}`, sizes: `${size}x${size}`, type: 'image/png', purpose })
    expect(manifest.icons).toEqual([
      icon('web-app-manifest-192x192.png', 192, 'maskable'),
      icon('web-app-manifest-512x512.png', 512, 'maskable'),
      icon('android-chrome-192x192.png', 192, 'any'),
      icon('android-chrome-512x512.png', 512, 'any'),
    ])
    const maskable = new Set(manifest.icons.filter((entry: { purpose: string }) => entry.purpose === 'maskable').map((entry: { src: string }) => entry.src))
    for (const entry of manifest.icons) {
      expect(existsSync(`public${entry.src}`)).toBe(true)
      if (entry.purpose === 'any') expect(maskable.has(entry.src)).toBe(false)
    }
  })
  it('When favicon.svg is read Then it declares an svg root and the 180 viewBox', () => {
    const svg = readFileSync('public/favicon.svg', 'utf8')
    expect(svg).toContain('<svg')
    expect(svg).toContain('viewBox="0 0 180 180"')
  })
  it('When apple and maskable PNGs are decoded Then every corner alpha is 255', () => {
    for (const file of ['apple-touch-icon.png', 'web-app-manifest-192x192.png', 'web-app-manifest-512x512.png']) {
      expect(cornerAlphas(readFileSync(`public/${file}`))).toEqual([255, 255, 255, 255])
    }
  })
  it('When the manifest is loaded Then no icon purpose is a space-combined value', () => {
    const manifest = JSON.parse(readFileSync('public/site.webmanifest', 'utf8'))
    for (const icon of manifest.icons) expect(icon.purpose ?? '').not.toMatch(/\s/)
  })
  it('When the manifest is loaded Then 192 and 512 maskable entries exist', () => {
    const manifest = JSON.parse(readFileSync('public/site.webmanifest', 'utf8'))
    for (const size of [192, 512]) {
      expect(manifest.icons).toContainEqual({ src: `/web-app-manifest-${size}x${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'maskable' })
      expect(existsSync(`public/web-app-manifest-${size}x${size}.png`)).toBe(true)
    }
  })
  it('When legacy assets are retired Then old files and head references are absent', () => {
    for (const file of ['favicon-32.png', 'icon-192.png']) {
      expect(existsSync(`public/${file}`)).toBe(false)
      expect(readFileSync('index.html', 'utf8')).not.toContain(file)
    }
  })
})
