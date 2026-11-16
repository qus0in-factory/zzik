/**
 * zzik usage collector — PM2 등록 파일(이 Mac은 원격 SSH 전용이라 launchd GUI 승인이 불가하다).
 * 등록: pm2 start collector/ecosystem.config.cjs && pm2 save
 *
 * 기본은 Postgres·900초. 승인된 D 전환에만 --env d1을 선택한다.
 * private 설정은 Node --env-file의 repo 루트 절대 경로에서 읽는다.
 * DB_URL·D1 식별자·토큰을 PM2 env/saved 설정에 복제하지 않는다.
 */
const path = require('node:path')
module.exports = {
  apps: [
    {
      name: process.env.PROCESS_NAME ?? 'zzik-usage-collector',
      script: __dirname + '/main.mjs',
      node_args: ['--env-file=' + path.join(__dirname, '..', '.env')],
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 30000,
      kill_timeout: 35000, // SIGTERM quiesce 30초 뒤 정리 여유
      env: {
        ZZIK_PROVIDERS: 'claude,codex,antigravity,opencode,grok,ollama', // 사용자 승인: ADR 0.6 G2a 통과
        ZZIK_AGY_CLI_PATH: '/Users/young-mini/.local/bin/agy',
        ZZIK_CODEX_AUTH_PATH: '/Users/young-mini/.codex/auth.json',
        ZZIK_INTERVAL_SEC: '900',
        ZZIK_STORE: 'postgres',
      },
      // Explicit selection only; the unqualified default remains postgres.
      env_d1: {
        ZZIK_STORE: 'd1',
        ZZIK_D1_AUTH: 'wrangler-oauth',
        ZZIK_D1_OAUTH_PROFILE: 'zzik-collector',
      },
      env_postgres: {
        ZZIK_STORE: 'postgres',
      },
      time: true,
    },
  ],
}
