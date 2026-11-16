import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { recompressPng } from '../../scripts/lib/recompress-png.mjs'
import { decodePng } from '../helpers/png'

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex')
const realPng = (file: string) => readFileSync(`public/${file}`)

describe('Given the PNGs shipped in public/', () => {
  it('When a favicon is recompressed Then the decoded pixels stay identical and the file gets smaller', () => {
    const source = realPng('favicon-96x96.png')
    const result = recompressPng(source)
    expect(result.length).toBeLessThan(source.length)
    expect(decodePng(result)).toEqual(decodePng(source))
  })
  it('When the apple touch icon is already at its final size Then the original buffer is returned untouched', () => {
    const source = realPng('apple-touch-icon.png')
    expect(recompressPng(source)).toBe(source)
  })
})

describe('Given malformed PNG input', () => {
  it('When the signature is not a PNG Then it throws instead of parsing garbage', () => {
    expect(() => recompressPng(Buffer.from('not a png at all'))).toThrow(/Not a PNG/)
  })
  it('When a chunk length runs past the end of the buffer Then it throws', () => {
    const truncated = Buffer.concat([PNG_SIGNATURE, Buffer.from([0, 0, 0, 100]), Buffer.from('IDAT'), Buffer.alloc(10)])
    expect(() => recompressPng(truncated)).toThrow(/truncated/i)
  })
  it('When bytes follow IEND Then they are ignored rather than parsed as another chunk', () => {
    const source = realPng('favicon-96x96.png')
    const trailing = Buffer.concat([source, Buffer.from([0xff, 0xff, 0xff, 0xff]), Buffer.from('JUNK'), Buffer.alloc(16)])
    expect(recompressPng(trailing).equals(recompressPng(source))).toBe(true)
  })
})
