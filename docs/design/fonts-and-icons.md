# 제공자 아이콘·제목 글꼴 출처와 라이선스

Refs #46. 코드 주석(`src/ui/usage/ProviderIcon.tsx`, `src/ui/index.css`)의 근거 문서다.

## 제공자 아이콘

`ProviderIcon`은 섹션 제목과 페이스 칩이 같이 쓴다. 색은 `currentColor`라 라이트·다크에서 모두 보인다.

| 제공자 | 아이콘 | 출처 | 라이선스 |
|---|---|---|---|
| Claude | Claude 로고 | `simple-icons` 16.37.0 (`siClaude`) | 아이콘 파일 CC0-1.0, 상표권은 Anthropic |
| Ollama | Ollama 로고 | `simple-icons` (`siOllama`) | CC0-1.0, 상표권은 Ollama |
| OpenCode | OpenCode 로고 | `simple-icons` (`siOpencode`) | CC0-1.0, 상표권은 OpenCode |
| ChatGPT (Codex) | 터미널 아이콘(대체) | `lucide-react` `Terminal` | ISC |
| Antigravity | 궤도 아이콘(대체) | `lucide-react` `Orbit` | ISC |
| Grok | 반짝임 아이콘(대체) | `lucide-react` `Sparkles` | ISC |

**공식 로고를 못 쓴 이유(확인 필요)**: `simple-icons`에는 OpenAI·xAI·Grok·Antigravity가 없다. 공식 사이트 favicon을 조회했을 때 openai.com은 403, x.ai·grok.com은 404였고, antigravity.google만 `favicon.svg`가 내려왔다. 다만 웹사이트 favicon에는 재사용 라이선스가 명시되어 있지 않아 가져오지 않고, 대체 아이콘을 썼다. 공식 프레스킷(브랜드 가이드)의 SVG를 쓸지는 사용자가 정한다.

## 제목 글꼴: A2z(에이투지체)

- 적용 범위: heading 요소(`h1`~`h4`)만. 토큰 `--font-heading`(`'A2z', 'Inter', 'Pretendard Variable', ...`). 본문·숫자·칩은 기존 Pretendard 유지.
- 출처: 눈누 에이투지체 페이지(https://noonnu.cc/font_page/1778), 웹폰트 CDN `https://cdn.jsdelivr.net/gh/projectnoonnu/2601-6@1.0/`.
- 라이선스(눈누 표기, 2026-11-14 확인): 상업적 사용 가능, 웹사이트 사용·서버 내 폰트 탑재(임베딩) 가능, 수정·재배포 가능, 폰트 파일 자체의 유료 판매만 금지(OFL). 출처 표기는 불필요(알려 주면 감사하다는 문구만 있음). 눈누도 정확한 범위는 저작권자에게 확인하라고 안내한다.
- 선언한 weight: **600(SemiBold) 하나**. 제목은 모두 `font-semibold`라 100~900 9종을 모두 내려받을 필요가 없다(`tests/ui/font-css.test.ts`가 제목 클래스를 검사). 다른 굵기가 필요해지면 그때 `-7Bold` 등을 추가한다.
- 한글 파일명(`에이투지체-6SemiBold.woff2`)은 퍼센트 인코딩한 URL로 쓴다. `font-display: swap`, `index.html`에 `cdn.jsdelivr.net` preconnect(`crossorigin`).
- CSP: Worker·HTML·`wrangler.jsonc`에 Content-Security-Policy 헤더가 없어 `font-src` 허용을 추가할 필요가 없다. 나중에 CSP를 도입하면 `font-src https://cdn.jsdelivr.net`과 `style-src`에 CDN을 허용해야 한다.
- 전송량: `docs/perf/0.6-font-subset.md`의 "A2z 제목 글꼴" 절.
