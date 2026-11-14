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
