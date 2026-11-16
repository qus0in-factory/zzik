import { inflateSync } from 'node:zlib'

/** Decode a non-interlaced 8-bit RGB or RGBA PNG. */
export function decodePng(png: Buffer) {
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
  return { width, height, channels, pixels }
}
