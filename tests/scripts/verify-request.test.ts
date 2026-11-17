import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
// @ts-expect-error scripts/verify-request.mjs is plain ESM checked by vitest
import { verifyRequestBody } from '../../scripts/verify-request.mjs'

const SCRIPT = fileURLToPath(new URL('../../scripts/verify-request.mjs', import.meta.url))

describe('Given a deployment confirmation request', () => {
  it('When version, summary and checks are given Then stdout has the four sections and no send step', () => {
    const built = verifyRequestBody({
      version: '0.6.28',
      summary: 'D1 읽기 배선을 연결했다.',
      checks: ['쿠키 없는 /api/usage 는 302', '제공자 6개 화면'],
    })
    expect(built.ok).toBe(true)
    const body = built.body as string
    expect(body).toContain('버전: 0.6.28')
    expect(body).toContain('바뀐 것\nD1 읽기 배선을 연결했다.')
    expect(body).toContain('검증\n- 쿠키 없는 /api/usage 는 302\n- 제공자 6개 화면')
    expect(body).toContain('확인 부탁\n')
    expect(body).toContain('다음\n')
    expect(body).toContain('완료 보고가 아닙니다')
    expect(body).toContain('배포 완료로 보고하지 않습니다')
    expect(body).not.toContain('DISCORD')
    expect(body).not.toContain('webhook')
  })

  it('When a required field is missing Then the body is refused', () => {
    expect(verifyRequestBody({ version: '', summary: '변경', checks: ['항목'] })).toMatchObject({ ok: false })
    expect(verifyRequestBody({ version: '0.6.28', summary: '  ', checks: ['항목'] })).toMatchObject({ ok: false })
    expect(verifyRequestBody({ version: '0.6.28', summary: '변경', checks: [] })).toMatchObject({ ok: false })
    expect(verifyRequestBody({ version: '0.6.28', summary: '변경', checks: ['  '] })).toMatchObject({ ok: false })
    expect(verifyRequestBody({ version: 'v0.6.28', summary: '변경', checks: ['항목'] })).toMatchObject({ ok: false })
  })
})

describe('Given a deployment completion notice', () => {
  it('When --done is selected Then the body has changed/verified/next and no confirmation section', () => {
    const built = verifyRequestBody({
      version: '0.6.29',
      summary: '릴리스 절차를 줄였다.',
      checks: ['tests/scripts 단위 테스트', 'pnpm typecheck'],
      done: true,
      next: '다음 릴리스에서 CI 대기만 확인한다.',
    })
    expect(built.ok).toBe(true)
    const body = built.body as string
    expect(body).toContain('버전: 0.6.29')
    expect(body).toContain('바뀐 것\n릴리스 절차를 줄였다.')
    expect(body).toContain('검증\n- tests/scripts 단위 테스트\n- pnpm typecheck')
    expect(body).toContain('다음\n다음 릴리스에서 CI 대기만 확인한다.')
    expect(body).not.toContain('확인 부탁')
    expect(body).not.toContain('완료 보고가 아닙니다')
    expect(body).not.toContain('배포 완료로 보고하지 않습니다')
  })

  it('When --done omits next Then uses a neutral next line', () => {
    const built = verifyRequestBody({
      version: '0.6.29',
      summary: '변경',
      checks: ['항목'],
      done: true,
    })
    expect(built.ok).toBe(true)
    expect(built.body as string).toContain('다음\n추가 조치는 없습니다.')
    expect(built.body as string).not.toContain('확인 부탁')
  })

  it('When --done is used without a required field Then refuses the body', () => {
    expect(verifyRequestBody({ version: '', summary: '변경', checks: ['항목'], done: true })).toMatchObject({ ok: false })
    expect(verifyRequestBody({ version: '0.6.29', summary: '  ', checks: ['항목'], done: true })).toMatchObject({ ok: false })
    expect(verifyRequestBody({ version: '0.6.29', summary: '변경', checks: [], done: true })).toMatchObject({ ok: false })
  })
})

describe('Given the confirmation request CLI', () => {
  it('When invoked Then prints only the body and does not read a webhook from the environment', () => {
    const result = spawnSync(
      process.execPath,
      [SCRIPT, '--version', '0.6.28', '--summary', '화면 배지를 고쳤다.', '--check', '배지 문구', '--check', '모바일 폭'],
      { encoding: 'utf8', env: { ...process.env, DISCORD_WEBHOOK_URL: 'https://synthetic-secret.example/webhook' } },
    )
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('바뀐 것\n화면 배지를 고쳤다.')
    expect(result.stdout).toContain('- 배지 문구')
    expect(result.stdout).toContain('- 모바일 폭')
    expect(result.stdout).toContain('확인 부탁')
    expect(result.stdout).toContain('다음')
    expect(`${result.stdout}${result.stderr}`).not.toContain('synthetic-secret')
    expect(result.stdout).not.toContain('curl')
  })

  it('When --done is selected Then prints the completion body without the confirmation section', () => {
    const result = spawnSync(
      process.execPath,
      [SCRIPT, '--done', '--version', '0.6.29', '--summary', '배포를 마쳤다.', '--check', '302 경로', '--next', '운영 로그를 본다.'],
      { encoding: 'utf8' },
    )
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('바뀐 것\n배포를 마쳤다.')
    expect(result.stdout).toContain('검증\n- 302 경로')
    expect(result.stdout).toContain('다음\n운영 로그를 본다.')
    expect(result.stdout).not.toContain('확인 부탁')
  })

  it('When checks are omitted Then exits 64 and writes nothing to stdout', () => {
    const result = spawnSync(process.execPath, [SCRIPT, '--version', '0.6.28', '--summary', '변경'], { encoding: 'utf8' })
    expect(result.status).toBe(64)
    expect(result.stdout).toBe('')
  })
})
