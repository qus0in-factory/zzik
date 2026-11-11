/**
 * zzik usage collector — PM2 등록 파일(이 Mac은 원격 SSH 전용이라 launchd GUI 승인이 불가하다).
 * 등록: pm2 start collector/ecosystem.config.cjs && pm2 save
 *
 * 상주 프로세스가 내부 setInterval(300s, ADR D2 주기)마다 runOnce를 돈다.
 * wrangler KV 어댑터는 repo의 node_modules를 쓰므로 PM2가 이 파일을 시작한 위치에서
 * node_modules가 보여야 한다(리포 루트에서 실행하는 것이 기본이다).
 */
module.exports = {
  apps: [
    {
      name: process.env.PROCESS_NAME ?? 'zzik-usage-collector',
      script: __dirname + '/main.mjs',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 30000,
      env: {
        ZZIK_PROVIDERS: 'claude,codex', // G2 통과(2026-11-12, docs/research/0.3-g2-codex-keys.md)
        ZZIK_CODEX_AUTH_PATH: '/Users/young-mini/.codex/auth.json',
        ZZIK_INTERVAL_SEC: '300',
        CLOUDFLARE_ACCOUNT_ID: 'c89ea66c04742e4f6f1feb8dd8e5b775',
        WRANGLER_SEND_METRICS: 'false',
      },
      time: true,
    },
  ],
}
