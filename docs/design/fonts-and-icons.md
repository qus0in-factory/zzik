# 제공자 아이콘·제목 글꼴 출처와 라이선스

Refs #46. 코드 주석(`src/ui/usage/ProviderIcon.tsx`, `src/ui/index.css`)의 근거 문서다.

## 제공자 아이콘

`ProviderIcon`은 섹션 제목과 페이스 칩이 같이 쓴다. 단색 `currentColor`라 라이트·다크에서 모두 보인다.

- 출처: `@lobehub/icons-static-svg` 1.102.0 (MIT, https://github.com/lobehub/lobe-icons). 필요한 6개의 path 데이터만 `src/ui/usage/provider-icon-paths.ts`에 복사했고 패키지는 의존성에 두지 않는다(번들 증가 최소화: 약 7 KB 소스). MIT 전문은 [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md)에 보존한다.
- 로고 자체의 상표권은 각 소유자에게 있다. 패키지의 MIT는 아이콘 파일의 배포 조건이다.

| 제공자 | 사용한 아이콘 파일 |
|---|---|
| Claude | `claude.svg` |
| ChatGPT (Codex) | `openai.svg` (OpenAI 마크) |
| Antigravity | `antigravity.svg` (Google Antigravity 마크가 패키지에 있어 Gemini 대체 불필요) |
| OpenCode | `opencode.svg` |
| Grok | `grok.svg` (xAI Grok 마크) |
| Ollama | `ollama.svg` |

이전에 쓰던 `simple-icons`(CC0)·`lucide-react` 대체 아이콘은 제거했다.

## 제목 글꼴: A2z(에이투지체)

- 적용 범위: heading 요소(`h1`~`h4`)만. 토큰 `--font-heading`(`'A2z', 'Inter', 'Pretendard Variable', ...`). 본문·숫자·칩은 기존 Pretendard 유지.
- 출처: 눈누 에이투지체 페이지(https://noonnu.cc/font_page/1778), 웹폰트 CDN `https://cdn.jsdelivr.net/gh/projectnoonnu/2601-6@1.0/`.
- 라이선스(눈누 표기, 2026-11-14 확인): 상업적 사용 가능, 웹사이트 사용·서버 내 폰트 탑재(임베딩) 가능, 수정·재배포 가능, 폰트 파일 자체의 유료 판매만 금지(OFL). 출처 표기는 불필요(알려 주면 감사하다는 문구만 있음). 눈누도 정확한 범위는 저작권자에게 확인하라고 안내한다.
- 선언한 weight: **600(SemiBold) 하나**. 제목은 모두 `font-semibold`라 100~900 9종을 모두 내려받을 필요가 없다(`tests/ui/font-css.test.ts`가 제목 클래스를 검사). 다른 굵기가 필요해지면 그때 `-7Bold` 등을 추가한다.
- 한글 파일명(`에이투지체-6SemiBold.woff2`)은 퍼센트 인코딩한 URL로 쓴다. `font-display: swap`, `index.html`에 `cdn.jsdelivr.net` preconnect(`crossorigin`).
- CSP: Worker·HTML·`wrangler.jsonc`에 Content-Security-Policy 헤더가 없어 `font-src` 허용을 추가할 필요가 없다. 나중에 CSP를 도입하면 `font-src https://cdn.jsdelivr.net`과 `style-src`에 CDN을 허용해야 한다.
- 전송량: `docs/perf/0.6-font-subset.md`의 "A2z 제목 글꼴" 절.

## Favicon 세트 (Refs #82)

[RealFaviconGenerator](https://realfavicongenerator.net/)의 현대 브라우저용 SVG·PNG, iOS Touch 아이콘, Android manifest 구성을 따른다. 기존 청록(`#057873`) 배경과 저빌 얼굴을 기존 PNG에서 `public/favicon.svg`의 벡터로 재구성했다. 불투명한 청록 바탕이 라이트·다크 탭에서 모두 대비를 유지하므로 SVG 내부 색상 전환은 필요 없다. 브라우저 UI의 theme-color만 라이트 청록·다크 `#171717`로 구분한다.

| 파일 (`public/`) | 용도 |
|---|---|
| `favicon.svg` | 편집 가능한 벡터 원본, 브라우저 탭, 앱·README 로고 |
| `favicon.ico` | PNG를 담은 16·32·48px 멀티 해상도 ICO |
| `favicon-96x96.png` | 96px 브라우저·검색용 PNG |
| `apple-touch-icon.png` | 180px, 불투명 정사각 배경과 얼굴 주변 여백. iOS가 모서리를 처리 |
| `android-chrome-192x192.png` | 192px `purpose: any`. `favicon.svg` 원본 비율과 둥근 모서리 |
| `android-chrome-512x512.png` | 512px `purpose: any`. 같은 원본 비율 |
| `web-app-manifest-192x192.png` | 192px `purpose: maskable`. 배경을 채우고 얼굴을 88%로 축소 |
| `web-app-manifest-512x512.png` | 512px `purpose: maskable`. 같은 축소 |
| `site.webmanifest` | 앱 이름·아이콘·시작 URL·standalone·테마/배경색 |

재생성: `node scripts/generate-favicons.mjs` (저장소의 어느 경로에서 실행해도 가능). macOS `sips`는 SVG를 직접 래스터화하지 못하므로 기존 `scripts/lib/cdp.mjs`와 설치된 Google Chrome의 SVG/canvas 렌더러를 사용한다. `CHROME_PATH`로 Chrome 경로를 바꿀 수 있다. npm·런타임 의존성을 추가하지 않았으며 외부 서비스·키·네트워크 호출을 사용하지 않는다. SVG를 수정한 뒤 생성 결과를 함께 커밋한다. 같은 Chrome 버전에서 재현 가능하며 렌더러 버전에 따라 안티앨리어싱은 달라질 수 있다.

`purpose: any`는 `android-chrome-*`다. RealFaviconGenerator가 maskable을 붙이기 전에 쓰던 비마스크 설치 아이콘 이름이라, 현재 RFG 이름인 `web-app-manifest-*`(maskable)와 파일을 나누기 위해서다. any는 `favicon.svg`의 둥근 모서리와 원본 얼굴 크기를 유지한다. maskable 설치 아이콘만 배경을 끝까지 채우고 얼굴만 중심 기준 88%로 줄인다. 로고 전체가 중앙 지름 80%의 안전 원 안에 들어가는지, apple(180)과 maskable이 불투명한지 생성 시 검사한다. `/tmp/zzik-favicon-preview-3.png`에는 16·32·48·96·180, any 192·512, maskable 192·512, 원형 마스크와 안전 원 표시를 라이트·다크 배경에 모아 저장한다. 정적 파일 계약은 `tests/ui/favicons.test.ts`에서 검사한다.

Cloudflare Access는 인증 쿠키로 정적 파일도 보호한다. iOS는 홈 화면 아이콘을 쿠키 없이 읽으므로, 빌드된 `index.html`의 `apple-touch-icon`만 `public/apple-touch-icon.png`의 data URI로 인라인한다(`vite.config.ts`, 빌드 전용). 개발 서버와 `index.html` 원본은 경로를 유지하고, PNG 파일도 루트 탐색용으로 남긴다. Access Bypass는 두지 않는다. 생성 스크립트는 그 PNG의 IDAT만 zlib 9로 무손실 재압축해 인라인 크기를 줄인다. 브라우저의 manifest 요청에 쿠키를 포함하도록 `index.html`의 manifest 링크에 `crossorigin="use-credentials"`를 둔다. 시작 URL은 같은 origin의 `/`이며 기존 Access 인증을 거친다. Worker에 별도 공개 예외나 캐시·인증 우회 라우트를 추가하지 않는다. 구형 `favicon-32.png`·`icon-192.png` 참조는 README·UI·테스트를 포함해 검색 후 새 SVG/PNG 경로로 교체했다.
