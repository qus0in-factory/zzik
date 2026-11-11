---
name: discord-notify
description: 작업(마일스톤·이슈 묶음·배포)이 끝났을 때 Discord로 완료 보고를 보낼 때 사용. .env 의 DISCORD_WEBHOOK_URL 을 쓰는 scripts/notify-discord.sh 실행법과 보고 형식.
---

# Discord 완료 보고

## 언제
- 사용자가 요청한 작업 묶음(예: 마일스톤 하나)이 모두 끝났을 때 opus가 한 번 보낸다. 중간 진행 상황은 보내지 않는다.
- 워커는 보내지 않는다(opus만).

## 실행
```bash
scripts/notify-discord.sh "<제목>" - <<'MSG'
<본문>
MSG
scripts/notify-discord.sh "<제목>" "<본문>" --dry-run   # 전송 없이 payload 확인
```
- 웹훅은 `.env`의 `DISCORD_WEBHOOK_URL`(gitignore됨). 값은 출력·커밋·이슈에 절대 남기지 않는다.
- 본문은 4000자에서 잘린다.

## 보고 형식
- 제목: `[zzik <마일스톤>] <한 줄 결과>`
- 본문: 완료 항목(이슈 번호), 배포/검증 결과, 사용자가 해야 할 일, 레포·사이트 링크.
