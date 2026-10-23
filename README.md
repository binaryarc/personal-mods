# right-panel-mods

[한국어](#한국어) | [English](#english)

## 한국어

Claude Code 오른쪽 패널 모드 마켓플레이스입니다.

| No. | 모드 | 기능 |
|---|---|---|
| 1 | task-progress | 진행 중인 작업의 진행률, 남은 시간, 다음 작업을 오른쪽 창에 보여줍니다 |

### 설치

Claude Code 프롬프트에서 실행합니다.

```
/plugin install task-progress --marketplace binaryarc/right-panel-mods
```

- 마켓플레이스 추가를 물으면 `y`, 범위는 `user` 를 고릅니다.
- 창이 보이지 않으면 `/progress` 를 입력합니다. 터미널 폭이 약 110열보다 좁으면 자동으로 열리지 않습니다.

### 업데이트

```
claude plugin marketplace update right-panel-mods
claude plugin update task-progress@right-panel-mods
```

열려 있는 세션에서는 `/reload-plugins` 를 입력합니다.

### task-progress 동작

- 현재 요청, 서브에이전트, 백그라운드 명령을 자동으로 표시합니다.
- 현재 요청은 haiku 모델이 한 줄로 요약해 보여줍니다. 요약에 실패하면 원문 첫 줄을 보여줍니다. 요청마다 haiku 호출 1회가 사용량에 더해집니다.
- 이번 요청에서 실패한 Bash, PowerShell 명령을 「실패한 명령」 칸에 보여줍니다. 같은 명령은 한 줄로 묶어 횟수를 표시하고, 최근 5개만 남깁니다. 서브에이전트와 백그라운드 명령은 포함하지 않습니다.
- 단계별 진행률은 Claude 가 `~/.claude/task-progress/{세션ID}.json` 을 작성해야 보입니다. 작성 방법은 모드가 메시지마다 Claude 에게 안내하므로 따로 설정할 것이 없습니다.
- 7일이 지난 세션 파일과 `/clear` 로 끝난 세션 파일은 자동으로 삭제됩니다. 삭제는 Windows 에서만 동작합니다.

### 개발

```
claude plugin validate task-progress
claude plugin test task-progress
```

## English

A marketplace of right-panel mods for Claude Code.

| No. | Mod | What it does |
|---|---|---|
| 1 | task-progress | Shows progress, remaining time, and next steps of the current task in the right pane |

### Install

Run this in the Claude Code prompt.

```
/plugin install task-progress --marketplace binaryarc/right-panel-mods
```

- When asked to add the marketplace, answer `y` and choose the `user` scope.
- If the pane does not appear, type `/progress`. It does not open automatically when the terminal is narrower than about 110 columns.

### Update

```
claude plugin marketplace update right-panel-mods
claude plugin update task-progress@right-panel-mods
```

In sessions that are already open, type `/reload-plugins`.

### How task-progress works

- The current request, subagents, and background commands are shown automatically.
- The current request is shown as a one-line summary written by the haiku model. If summarizing fails, the first line of the original message is shown. Each request adds one haiku call to your usage.
- Bash and PowerShell commands that failed during the current request appear under "Failed commands". Repeated failures of the same command are grouped into one line with a count, and only the latest 5 are kept. Commands run by subagents or in the background are not included.
- Per-step progress appears only when Claude writes `~/.claude/task-progress/{sessionId}.json`. The mod tells Claude how to write it with every message, so no extra setup is needed.
- Session files older than 7 days and files of sessions ended with `/clear` are deleted automatically. Deletion works on Windows only.

### Development

```
claude plugin validate task-progress
claude plugin test task-progress
```
