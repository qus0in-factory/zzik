/**
 * 빌드 시 주입되는 이력 기능 플래그(vite.config.ts의 define). 기본 false — 환경 변수 `VITE_HISTORY_ENABLED=1`(또는 true)로 켠다.
 * false면 조립 루트가 이력 infra(IndexedDB·HTTP 게이트웨이)를 불러오지 않는다(번들에서 제거된다).
 */
declare const __HISTORY_ENABLED__: boolean
