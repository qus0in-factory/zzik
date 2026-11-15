// Lossless IDAT recompression. Pixel filters stay as Chrome wrote them; only the deflate level changes.
import { crc32, deflateSync, inflateSync } from 'node:zlib'

export function recompressPng(png) {
  if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Not a PNG')
  let offset = 8
  const before = []
  const idat = []
  const after = []
  let started = false
  while (offset < png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.toString('ascii', offset + 4, offset + 8)
    const data = png.subarray(offset + 8, offset + 8 + length)
    const chunk = png.subarray(offset, offset + 12 + length)
    if (type === 'IDAT') {
      started = true
      idat.push(data)
    } else if (started) after.push(chunk)
    else before.push(chunk)
    offset += 12 + length
  }
  const current = Buffer.concat(idat)
  const packed = deflateSync(inflateSync(current), { level: 9 })
  if (packed.length >= current.length) return png
  const name = Buffer.from('IDAT')
  const size = Buffer.alloc(4)
  size.writeUInt32BE(packed.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([name, packed])) >>> 0)
  return Buffer.concat([png.subarray(0, 8), ...before, size, name, packed, checksum, ...after])
}
