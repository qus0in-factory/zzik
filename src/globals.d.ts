/** vite `define`으로 주입되는 package.json의 version(vite.config.ts). */
declare const __APP_VERSION__: string

/**
 * 빌드 시 주입되는 이력 기능 플래그(vite.config.ts의 define). 기본 true(v0.6.3~) — 환경 변수 `VITE_HISTORY_ENABLED=0`(또는 false)로 끈다.
 * 끄면(false) 조립 루트가 이력 infra(IndexedDB·HTTP 게이트웨이)를 불러오지 않는다(번들에서 제거된다).
 */
declare const __HISTORY_ENABLED__: boolean
