// Gemini 이미지 생성 API로 몽골리안 저빌 이미지를 만든다 (favicon·캐릭터 참고용).
// 사용: node --env-file=<.env 경로> scripts/generate-gerbil-image.mjs <출력.png> ["프롬프트"]
// 키는 GEMINI_API_KEY 환경변수로만 읽는다.
import { writeFileSync } from 'node:fs'

const MODEL = 'gemini-3.1-flash-image'
const DEFAULT_PROMPT =
  'A cute Mongolian gerbil app icon: front-facing round head, sandy tan fur, big dark eyes, small round ears, white belly, ' +
  'flat vector style with bold simple shapes, centered, plain solid background, square, no text.'

const [out, prompt = DEFAULT_PROMPT] = process.argv.slice(2)
if (!out) throw new Error('usage: generate-gerbil-image.mjs <out.png> [prompt]')
const key = process.env.GEMINI_API_KEY
if (!key) throw new Error('GEMINI_API_KEY is not set')

const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
  method: 'POST',
  headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
  body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['IMAGE'] } }),
})
if (!res.ok) throw new Error(`Gemini API ${res.status}`)
const json = await res.json()
const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)
if (!part) throw new Error('no image in response')
writeFileSync(out, Buffer.from(part.inlineData.data, 'base64'))
console.log('saved', out, `(${MODEL})`)
