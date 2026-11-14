# Zzik : AI 사용량 대시보드

<img src="public/icon-192.png" alt="Zzik 저빌 아이콘" width="96" height="96" />

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vite.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![TanStack Query](https://img.shields.io/badge/TanStack%20Query-FF4154?style=flat-square&logo=reactquery&logoColor=white)](https://tanstack.com/query)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare%20Workers-F38020?style=flat-square&logo=cloudflareworkers&logoColor=white)](https://workers.cloudflare.com/)
[![Cloudflare Access](https://img.shields.io/badge/Cloudflare%20Access-F38020?style=flat-square&logo=cloudflare&logoColor=white)](https://www.cloudflare.com/zero-trust/products/access/)
[![PostgreSQL (Neon)](https://img.shields.io/badge/PostgreSQL%20%28Neon%29-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://neon.tech/)
[![Drizzle ORM](https://img.shields.io/badge/Drizzle%20ORM-C5F74F?style=flat-square&logo=drizzle&logoColor=black)](https://orm.drizzle.team/)
[![Vitest](https://img.shields.io/badge/Vitest-6E9F18?style=flat-square&logo=vitest&logoColor=white)](https://vitest.dev/)
[![pnpm](https://img.shields.io/badge/pnpm-F69220?style=flat-square&logo=pnpm&logoColor=white)](https://pnpm.io/)

![Zzik 데스크톱 대시보드](docs/screenshots/desktop.png)

## 아키텍처

```mermaid
architecture-beta
  group local(server)[로컬 머신]
  group neon(cloud)[Neon]
  group cf(cloud)[Cloudflare]

  service agy(disk)[agy CLI] in local
  service collector(server)[수집기 PM2] in local
  service db(database)[PostgreSQL] in neon
  service worker(server)[Worker] in cf
  service access(internet)[Access] in cf
  service spa(internet)[정적 SPA] in cf
  service discord(internet)[Discord 알림]

  agy:R --> L:collector
  collector:R --> L:db
  db:R --> L:worker
  worker:R --> L:access
  access:R --> L:spa
  collector:B --> T:discord
```

- 수집기는 PM2 상주 프로세스로 900초마다 6개 제공자(Claude, ChatGPT(Codex), Antigravity, OpenCode, Grok, Ollama)의 사용량을 읽어 Postgres에 저장한다. 값이 바뀌거나 6시간이 지나면 이력을 남기고, 주의·위험 진입/해제와 최상위 한도 리셋은 Discord로 알린다.
- Worker는 `/api/usage*`에서 저장된 사용량을 돌려주고, 정적 자산과 API는 Cloudflare Access 뒤에서 보호된다.
- 프론트는 `ui → app → domain` 방향으로만 의존하고, `infra`는 app이 주입한다. 화면은 페이스 칩·한도 카드·사용량 추이 차트(uPlot)로 사용률을 보여 준다.
