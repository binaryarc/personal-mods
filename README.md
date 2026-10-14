# personal-mods

개인용 Claude Code 모드 마켓플레이스다.

| No. | 모드 | 하는 일 |
|---|---|---|
| 1 | task-progress | 진행 중인 작업의 진행률, 예상 남은 시간, 다음 작업을 오른쪽 창에 보여준다 |

## 설치

공개 저장소라 GitHub 로그인 없이 받을 수 있다. Claude Code 터미널 프롬프트에서 아래 한 줄을 친다.

```
/plugin install task-progress --marketplace binaryarc/personal-mods
```

마켓플레이스 추가를 물으면 `y`, 범위는 user 를 고른다. 설치하면 바로 켜진다.
창이 안 보이면 `/progress` 를 친다. 터미널 폭이 좁으면(약 110열 미만) 저절로 열리지 않는다.

## 업데이트

저장소에 새 버전을 푸시한 뒤 각 PC 에서 아래를 실행하고, 열린 세션에서는 `/reload-plugins` 를 친다.

```
claude plugin marketplace update personal-mods
claude plugin update task-progress@personal-mods
```

## task-progress 동작

- 현재 요청, 서브에이전트, 백그라운드 명령은 모드가 자동으로 표시한다.
- 단계별 진행률은 Claude 가 `{사용자 폴더}/.claude/task-progress/{세션ID}.json` 을 써야 보인다. 쓰는 법은 모드가 사용자 메시지마다 붙이는 안내문에 들어 있어 CLAUDE.md 를 따로 고치지 않아도 된다.
- 7일 지난 다른 세션 파일과 `/clear` 로 끝난 세션 파일은 모드가 지운다. 파일 삭제는 Windows PowerShell 로 하므로 Windows 가 아닌 PC 에서는 삭제만 동작하지 않는다.

## 개발

```
claude plugin validate task-progress
claude plugin test task-progress
```
