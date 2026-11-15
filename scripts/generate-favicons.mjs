// Rebuild favicon assets from public/favicon.svg with the existing local Chrome/CDP helper.
// No npm additions, network calls or AI generation. CHROME_PATH may override Chrome.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { openPage } from './lib/cdp.mjs'
import { recompressPng } from './lib/recompress-png.mjs'

const root = new URL('../', import.meta.url)
const svg = readFileSync(new URL('public/favicon.svg', root), 'utf8')
// Square the background for iOS and maskable icons. A missed rx leaves transparent corners.
const apple = svg.replace('rx="30"', 'rx="0"')
if (apple === svg) throw new Error('favicon.svg rx="30" was not replaced')
// Keep the background edge-to-edge; scale only the logo into the central 80% circle.
const maskable = apple.replace('<g id="gerbil"', '<g transform="translate(90 90) scale(.88) translate(-90 -90)" id="gerbil"')
if (maskable === apple || maskable === svg) throw new Error('maskable favicon variant was not derived from the source')
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
    output.any192 = render(images.svg, 192);
    output.any512 = render(images.svg, 512);
    output[192] = render(images.maskable, 192);
    output[512] = render(images.maskable, 512);
    // Full opacity for apple and maskable. Maskable logos must stay inside the safe circle.
    const inspect = (image, size, safeZone) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0, size, size);
      const pixels = ctx.getImageData(0, 0, size, size).data;
      const background = [pixels[0], pixels[1], pixels[2]];
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        if (pixels[i + 3] !== 255) throw new Error('Install icon must be opaque');
        const sameBackground = pixels[i] === background[0] && pixels[i + 1] === background[1] && pixels[i + 2] === background[2];
        if (safeZone && !sameBackground && Math.hypot(x + .5 - size / 2, y + .5 - size / 2) > size * .4)
          throw new Error('Logo exceeds maskable safe circle');
      }
    };
    inspect(images.apple, 180, false);
    for (const size of [192, 512]) inspect(images.maskable, size, true);
    const preview = document.createElement('canvas');
    preview.width = 1680; preview.height = 1760;
    const ctx = preview.getContext('2d');
    const small = [['16', images.svg, 16], ['32', images.svg, 32], ['48', images.svg, 48], ['96', images.svg, 96], ['180', images.apple, 180], ['any 192', images.svg, 192], ['mask 192', images.maskable, 192]];
    const large = [['any 512', images.svg, 512], ['mask 512', images.maskable, 512]];
    for (const [row, bg] of ['#fafafa', '#171717'].entries()) {
      const top = row * 880;
      ctx.fillStyle = bg; ctx.fillRect(0, top, preview.width, 880);
      ctx.fillStyle = row ? '#ffffff' : '#171717'; ctx.font = '18px sans-serif';
      ctx.fillText(row ? 'Dark background' : 'Light background', 20, top + 28);
      let x = 20;
      for (const [label, image, size] of small) {
        ctx.fillText(label, x, top + 55);
        ctx.drawImage(image, x, top + 70, size, size);
        x += size + 22;
      }
      x = 20;
      const y2 = top + 320;
      for (const [label, image, size] of large) {
        ctx.fillText(label, x, y2 - 12);
        ctx.drawImage(image, x, y2, size, size);
        x += size + 22;
      }
      ctx.fillText('512 circular mask', x, y2 - 12);
      ctx.save(); ctx.beginPath(); ctx.arc(x + 100, y2 + 100, 100, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(images.maskable, x, y2, 200, 200); ctx.restore();
      ctx.fillText('80% safe area', x + 220, y2 - 12);
      ctx.drawImage(images.maskable, x + 220, y2, 200, 200);
      ctx.strokeStyle = '#ff4d94'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x + 320, y2 + 100, 80, 0, Math.PI * 2); ctx.stroke();
    }
    output.preview = preview.toDataURL('image/png').split(',')[1];
    return output;
  })()` })
  if (evaluation.exceptionDetails) throw new Error(evaluation.exceptionDetails.exception?.description ?? evaluation.exceptionDetails.text)
  const results = evaluation.result.value
  if (!results) throw new Error('Image rendering returned no data')
  const png = (key) => Buffer.from(results[key], 'base64')
  for (const [key, filename] of Object.entries({ 96: 'favicon-96x96.png', apple: 'apple-touch-icon.png', any192: 'android-chrome-192x192.png', any512: 'android-chrome-512x512.png', 192: 'web-app-manifest-192x192.png', 512: 'web-app-manifest-512x512.png' })) {
    const bytes = filename === 'apple-touch-icon.png' ? recompressPng(png(key)) : png(key)
    writeFileSync(new URL(`public/${filename}`, root), bytes)
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
  const preview = '/tmp/zzik-favicon-preview-3.png'
  writeFileSync(preview, png('preview'))
  console.log(`Generated favicon PNG/ICO set from ${fileURLToPath(new URL('public/favicon.svg', root))}\nPreview: ${preview}`)
} finally {
  page.close()
}
