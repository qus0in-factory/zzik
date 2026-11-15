// Rebuild favicon assets from public/favicon.svg with the existing local Chrome/CDP helper.
// No npm additions, network calls or AI generation. CHROME_PATH may override Chrome.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { openPage } from './lib/cdp.mjs'

const root = new URL('../', import.meta.url)
const svg = readFileSync(new URL('public/favicon.svg', root), 'utf8')
// Keep the background edge-to-edge; scale only the logo into the central 80% circle.
const maskable = svg.replace('rx="30"', 'rx="0"').replace('<g id="gerbil"', '<g transform="translate(90 90) scale(.88) translate(-90 -90)" id="gerbil"')
const apple = svg.replace('rx="30"', 'rx="0"')
const page = await openPage()
try {
  await page.send('Runtime.enable')
  const evaluation = await page.send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async () => {
    const variants = ${JSON.stringify({ svg, apple, maskable })};
    const images = {};
    for (const [name, source] of Object.entries(variants)) {
      const image = new Image();
      image.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(source)));
      await image.decode();
      images[name] = image;
    }
    const render = (image, size) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      canvas.getContext('2d').drawImage(image, 0, 0, size, size);
      return canvas.toDataURL('image/png').split(',')[1];
    };
    const output = {};
    for (const size of [16, 32, 48, 96]) output[size] = render(images.svg, size);
    output.apple = render(images.apple, 180);
    output[192] = render(images.maskable, 192);
    output[512] = render(images.maskable, 512);
    // Verify the rasterized install icons: full opacity, all logo pixels in the safe circle.
    for (const size of [192, 512]) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(images.maskable, 0, 0, size, size);
      const pixels = ctx.getImageData(0, 0, size, size).data;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        if (pixels[i + 3] !== 255) throw new Error('Install icon must be opaque');
        const background = pixels[i] === 5 && pixels[i+1] === 120 && pixels[i+2] === 115;
        if (!background && Math.hypot(x + .5 - size/2, y + .5 - size/2) > size * .4)
          throw new Error('Logo exceeds maskable safe circle');
      }
    }
    const preview = document.createElement('canvas');
    preview.width = 1400; preview.height = 1320;
    const ctx = preview.getContext('2d');
    for (const [row, bg] of ['#fafafa', '#171717'].entries()) {
      const top = row * 660;
      ctx.fillStyle = bg; ctx.fillRect(0, top, 1400, 660);
      ctx.fillStyle = row ? '#ffffff' : '#171717'; ctx.font = '18px sans-serif';
      ctx.fillText(row ? 'Dark background' : 'Light background', 20, top + 28);
      let x = 20;
      for (const size of [16,32,48,96,180,512]) {
        const image = size === 180 ? images.apple : size === 512 ? images.maskable : images.svg;
        ctx.drawImage(image, x, top + 70, size, size);
        ctx.fillText(String(size), x, top + 55);
        x += size + 22;
      }
      ctx.fillText('512 circular mask', 1160, top + 55);
      ctx.save(); ctx.beginPath(); ctx.arc(1260, top + 170, 100, 0, Math.PI*2); ctx.clip();
      ctx.drawImage(images.maskable, 1160, top + 70, 200, 200); ctx.restore();
      ctx.fillText('80% safe area', 1160, top + 310);
      ctx.drawImage(images.maskable, 1160, top + 330, 200, 200);
      ctx.strokeStyle = '#ff4d94'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(1260, top + 430, 80, 0, Math.PI*2); ctx.stroke();
    }
    output.preview = preview.toDataURL('image/png').split(',')[1];
    return output;
  })()` })
  if (evaluation.exceptionDetails) throw new Error(evaluation.exceptionDetails.exception?.description ?? evaluation.exceptionDetails.text)
  const results = evaluation.result.value
  if (!results) throw new Error('Image rendering returned no data')
  const png = (key) => Buffer.from(results[key], 'base64')
  for (const [key, filename] of Object.entries({ 96: 'favicon-96x96.png', apple: 'apple-touch-icon.png', 192: 'web-app-manifest-192x192.png', 512: 'web-app-manifest-512x512.png' })) {
    writeFileSync(new URL(`public/${filename}`, root), png(key))
  }
  const header = Buffer.alloc(6 + 3 * 16)
  header.writeUInt16LE(1, 2); header.writeUInt16LE(3, 4)
  let offset = header.length
  const entries = [16, 32, 48].map((size, i) => {
    const bytes = png(size), entry = 6 + i * 16
    header[entry] = header[entry + 1] = size
    header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(bytes.length, entry + 8); header.writeUInt32LE(offset, entry + 12)
    offset += bytes.length
    return bytes
  })
  writeFileSync(new URL('public/favicon.ico', root), Buffer.concat([header, ...entries]))
  const preview = '/tmp/zzik-favicon-preview.png'
  writeFileSync(preview, png('preview'))
  console.log(`Generated favicon PNG/ICO set from ${fileURLToPath(new URL('public/favicon.svg', root))}\nPreview: ${preview}`)
} finally {
  page.close()
}
