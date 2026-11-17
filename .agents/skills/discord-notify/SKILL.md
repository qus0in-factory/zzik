---
name: discord-notify
description: 작업(마일스톤·이슈 묶음·배포) 완료 보고 또는 배포 후 운영 화면 확인 요청을 Discord로 보낼 때 사용. .env 의 DISCORD_WEBHOOK_URL 을 쓰는 scripts/notify-discord.sh 실행법과 보고 형식.
---

# Discord 완료 보고

> 전역 스킬 `discord-notify`(`~/.agents/skills/discord-notify`)에 메시지 작성 가이드가 있다. 이 문서는 zzik 전용 실행법이다.

## 언제
- 사용자가 요청한 작업 묶음이 모두 끝났을 때 opus가 완료 보고를 한 번 보낸다. 예외: 배포 후 운영 화면 **확인 요청**은 완료 보고 전에 한 번 보낸다(`herdr-orchestration` (c), `zzik-deploy` 3절). 그 밖의 중간 진행 상황은 보내지 않는다.
- 워커는 보내지 않는다(opus만).

## 실행
```bash
scripts/notify-discord.sh "<제목>" - <<'MSG'
<본문>
MSG
scripts/notify-discord.sh "<제목>" "<본문>" --dry-run   # 전송 없이 payload 확인
scripts/notify-discord.sh "<제목>" "<본문>" --image /tmp/usage.png --image /tmp/ui.png --dry-run
```
- `--image <경로>`는 여러 번 지정할 수 있고 최대 4장이다. 이미지가 있으면 multipart/form-data로 보내고 각 이미지를 embed `image`의 `attachment://파일명`으로 참조한다.
- 웹훅은 `.env`의 `DISCORD_WEBHOOK_URL`(gitignore됨). 값은 출력·커밋·이슈에 절대 남기지 않는다.
- 보낸이 이름은 웹훅 기본 이름을 쓴다(payload에 `username`을 넣지 않는다).
- 배포 알림·확인 요청에는 워커가 촬영하고 opus가 직접 판정한 로컬 렌더 스크린샷을 첨부하고 실데이터/fixture 여부와 한계를 본문에 적는다. 실데이터가 불가하면 `?fixture=normal`을 쓰며, fixture는 실제 계정·인증/API/DB·운영 화면 검증을 대신하지 않는다. 인증 우회가 필요하면 `zzik-deploy` 2절의 `/tmp` 임시 워크트리만 사용한다.
- 본문은 4000자에서 잘린다.
- 확인 요청 본문(바뀐 것·검증·확인 부탁·다음)은 `scripts/verify-request.mjs`가 stdout만 만든다. 전송은 그 출력을 `scripts/notify-discord.sh`에 파이프한다.

## 보고 형식
- 완료 제목: `[zzik <마일스톤>] <한 줄 결과>`
- 확인 요청 제목: `[zzik <버전>] 확인 요청: <볼 항목>` — 운영 링크·기술 검증·사용자가 볼 항목·스크린샷 종류·한계를 적고 사용자 확인을 기다린다.
- 본문: 완료 항목(이슈 번호), 배포/검증 결과, 사용자가 해야 할 일, 레포·사이트 링크.
