import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Failure, Job, Progress, Request, Task } from '../types'

// 진행 상황 파일 폴더. 세션마다 {세션ID}.json 하나를 Claude 가 적는다(선택)
// PC 마다 사용자 폴더가 달라 session.start 에서 환경변수로 정한다
let dir = ''
const PANE = 'task-progress'
const TITLE = '작업 진행'
const POLL_MS = 2000
const KEEP_DONE_JOBS = 5
const KEEP_FAILURES = 5
// 세션별 진행 파일 보관 기간. 마지막 수정 뒤 이 기간이 지나면 다음 세션 시작 때 지운다
export const TTL_MS = 7 * 24 * 60 * 60 * 1000
const POWERSHELL = 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'

const data = atom({ plugin: 'task-progress', key: 'data' } as const, null)
const fileTime = atom({ plugin: 'task-progress', key: 'fileTime' } as const, 0)
const now = atom({ plugin: 'task-progress', key: 'now' } as const, 0)
const error = atom({ plugin: 'task-progress', key: 'error' } as const, null)
const request = atom({ plugin: 'task-progress', key: 'request' } as const, null)
const jobs = atom({ plugin: 'task-progress', key: 'jobs' } as const, [])
const failures = atom({ plugin: 'task-progress', key: 'failures' } as const, [])

export function percentOf(t: Task): number {
  if (typeof t.percent === 'number') return Math.max(0, Math.min(100, t.percent))
  return t.status === 'done' ? 100 : 0
}

// 남은 초. etaSec 가 있으면 그 값, 없으면 경과시간과 진행률로 비례 계산
export function remainingSec(t: Task, nowMs: number): number | null {
  if (t.status === 'done') return 0
  if (typeof t.etaSec === 'number') return Math.max(0, t.etaSec)
  const p = percentOf(t)
  if (t.status !== 'running' || typeof t.startedAt !== 'number' || p <= 0) return null
  const elapsed = (nowMs - t.startedAt) / 1000
  return Math.max(0, (elapsed * (100 - p)) / p)
}

export function fmtSec(s: number | null): string {
  if (s === null) return '계산 중'
  if (s < 60) return `${Math.round(s)}초`
  const m = Math.round(s / 60)
  return m < 60 ? `약 ${m}분` : `약 ${Math.floor(m / 60)}시간 ${m % 60}분`
}

// 경과 시간 m:ss (1시간 넘으면 h:mm:ss)
export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

export function bar(p: number, width: number): string {
  const full = Math.round((p / 100) * width)
  return '█'.repeat(full) + '░'.repeat(width - full)
}

export function firstLine(text: string): string {
  return (text.split('\n').find(l => l.trim() !== '') ?? '').trim()
}

export function oneLine(text: string, max: number): string {
  const line = firstLine(text)
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

// 백그라운드 작업 완료 알림에서 tool_use_id 와 status 를 뽑는다
export function parseNotification(text: string): { toolUseId: string; status: string }[] {
  const out: { toolUseId: string; status: string }[] = []
  const blocks = text.split('<task-notification>').slice(1)
  for (const b of blocks) {
    const id = /<tool-use-id>\s*([^<\s]+)\s*<\/tool-use-id>/.exec(b)?.[1]
    if (!id) continue
    const status = /<status>\s*([^<\s]+)\s*<\/status>/.exec(b)?.[1] ?? 'completed'
    out.push({ toolUseId: id, status })
  }
  return out
}

// 끝난 작업은 최근 몇 개만 남긴다
export function trimJobs(list: Job[]): Job[] {
  const running = list.filter(j => j.endedAt === null)
  const done = list.filter(j => j.endedAt !== null).slice(-KEEP_DONE_JOBS)
  return [...done, ...running]
}

// 오류 문구에서 보일 한 줄. 첫 줄이 "Exit code 1" 뿐이면 그 다음 줄이 원인이라 그 줄을 쓴다
export function errorLine(text: string): string {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l !== '')
  return lines.find(l => !/^Exit code -?\d+$/.test(l)) ?? lines[0] ?? ''
}

// 실패한 명령을 더한다. 같은 명령이면 횟수만 올리고, 최근에 실패한 몇 개만 남긴다
export function addFailure(list: Failure[], f: Omit<Failure, 'count'>): Failure[] {
  const prev = list.find(x => x.command === f.command)
  const rest = list.filter(x => x.command !== f.command)
  return [...rest, { ...f, count: (prev?.count ?? 0) + 1 }].slice(-KEEP_FAILURES)
}

// 진행 상황 파일 폴더. Windows 는 USERPROFILE, 그 밖은 HOME 아래 .claude/task-progress
export function progressDir(userProfile: string | undefined, home: string | undefined): string {
  const base = (userProfile || home || '.').replace(/\\/g, '/').replace(/\/+$/, '')
  return `${base}/.claude/task-progress`
}

// 세션별 진행 상황 파일 경로. /clear 뒤에는 세션 ID 가 바뀌므로 매번 다시 만든다
export function progressFile(folder: string, sessionId: string): string {
  return `${folder}/${sessionId}.json`
}

// Claude 에게 이 세션이 쓸 파일 경로와 쓰는 법을 알리는 안내문. 사용자 메시지마다 덧붙인다.
// 규칙을 여기 담아 두면 PC 마다 CLAUDE.md 를 고치지 않아도 된다
export function fileNotice(path: string): string {
  return [
    `작업 진행 창 파일: 이 세션의 진행 상황 파일 경로는 ${path} 이다. 다른 세션의 파일을 읽거나 쓰지 않는다.`,
    '단계가 2개 이상이거나 5분 넘게 걸릴 작업이면 이 파일을 쓴다. 짧은 질문 답변, 한 단계로 끝나는 작업에는 쓰지 않는다.',
    '형식: {"title": "...", "tasks": [{"name": "...", "status": "done|running|next", "percent": 0~100, "startedAt": epoch ms, "etaSec": 초, "note": "..."}]}. name, status 만 필수다.',
    '작업 시작 때 전체 단계를 적고, 단계가 시작되거나 끝날 때마다 파일을 통째로 다시 쓴다. 마지막 단계가 끝나면 모두 done 으로 바꾼다.',
    'running 단계에는 startedAt, percent 를 넣고 etaSec 는 넣지 않는다(창이 남은 시간을 계산한다). 긴 단계는 도는 중에도 percent, note 를 고쳐 쓴다. etaSec 는 next 단계에만 넣는다.',
    '답변에서 이 파일 갱신을 따로 언급하지 않는다.',
  ].join(' ')
}

// 현재 요청을 해석할 모델과 입력 길이 상한
const SUMMARY_MODEL = 'haiku'
const SUMMARY_INPUT_MAX = 2000

// 사용자 요청을 해석해 한 줄로 적게 하는 질문. 요청 원문은 태그로 감싸 지시와 분리한다
export function summaryPrompt(text: string): string {
  return [
    '아래 <request> 는 사용자가 코딩 도우미에게 보낸 요청이다. 사용자가 실제로 무엇을 원하는지 해석해 한국어 한 문장으로 적어라.',
    '원문을 그대로 옮기지 말고, 오타와 줄임말을 바로잡아 할 일이 드러나게 쓴다. 40자 안팎, "~하기" 나 "~ 확인" 처럼 명사형으로 끝낸다.',
    '답은 그 문장 하나만 쓴다. 따옴표, 머리말, 설명을 붙이지 않는다.',
    `<request>\n${text.slice(0, SUMMARY_INPUT_MAX)}\n</request>`,
  ].join('\n')
}

// 모델 답에서 첫 줄만 쓰고 감싼 따옴표를 뗀다. 비었으면 null
export function cleanSummary(reply: string): string | null {
  const line = oneLine(reply, 200).replace(/^["'“‘`]+|["'”’`]+$/g, '').trim()
  return line === '' ? null : line
}

// 창에 보일 현재 요청 문구: 해석한 문장, 해석 중이면 안내, 실패했으면 원문
export function requestLabel(req: Request): string {
  if (typeof req.summary === 'string') return req.summary
  return req.summary === null ? req.text : '요청 해석 중…'
}

// 도구 호출이 백그라운드로 돌았는지. 에이전트는 호출 인자에 run_in_background 가 없어
// agent.spawn 이 알려 준 값(spawned)으로, 셸 명령은 호출 인자로 판단한다
export function ranInBackground(isAgent: boolean, args: Record<string, unknown>, spawned: ReadonlySet<string>, id: string): boolean {
  return isAgent ? spawned.has(id) : args.run_in_background === true
}

// 지울 파일 이름: .json 이고, 지금 세션 파일이 아니고, 마지막 수정이 TTL 보다 오래된 것
export function staleFiles(files: { name: string; mtimeMs: number }[], nowMs: number, sessionId: string): string[] {
  return files
    .filter(f => f.name.endsWith('.json') && f.name !== `${sessionId}.json` && nowMs - f.mtimeMs > TTL_MS)
    .map(f => f.name)
}

// 진행 상황 파일을 보여줄지: 지금 요청 중에 고쳐졌거나 진행 중 단계가 있을 때만
export function showFile(p: Progress | null, mtime: number, req: Request | null): boolean {
  if (!p || p.tasks.length === 0) return false
  if (!req) return true
  return mtime >= req.startedAt || p.tasks.some(t => t.status === 'running')
}

// 파일 지우기. $.fs 에 삭제가 없어 PowerShell 로 지운다.
// PowerShell 은 / 경로도 받는다. 파일 이름은 세션 ID 라 작은따옴표가 들어가지 않는다
async function removeFiles($: { process: { run: (argv: readonly string[]) => Promise<unknown> } }, names: string[]) {
  const targets = names.map(n => `'${dir}/${n}'`).join(',')
  await $.process.run([POWERSHELL, '-NoProfile', '-Command', `Remove-Item -LiteralPath ${targets} -Force -ErrorAction SilentlyContinue`])
}

// /clear 로 끝난 세션의 파일 이름. 다른 이유로 끝난 세션은 --resume 으로 돌아올 수 있어 남긴다
export function clearedFile(reason: string, sessionId: string): string | null {
  return reason === 'clear' ? `${sessionId}.json` : null
}

export const register: Register = on => {
  // 백그라운드로 시작한 에이전트의 tool_use_id. 그 에이전트는 호출이 돌아온 뒤에도 돌고, 완료 알림으로 끝난다
  const backgroundAgents = new Set<string>()

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'progress', description: '작업 진행 창 열기' })
    dir = progressDir(await $.env.get('USERPROFILE'), await $.env.get('HOME'))

    const poll = async () => {
      try {
        const file = progressFile(dir, await $.session.id())
        const st = await $.fs.stat(file)
        const parsed = JSON.parse(await $.fs.read(file)) as Progress
        await update($, data, () => (Array.isArray(parsed?.tasks) ? parsed : null))
        await update($, fileTime, () => st.mtimeMs)
        await update($, error, () => null)
      } catch (err) {
        await update($, data, () => null)
        await update($, error, () => (err instanceof Error ? err.message : String(err)))
      }
      const t = await $.clock.now()
      await update($, now, () => t)
    }
    // 오래된 세션 파일 정리. 실패해도 창 표시에는 영향이 없게 조용히 넘어간다
    try {
      const sid = await $.session.id()
      const nowMs = await $.clock.now()
      // 처음 쓰는 PC 에는 폴더가 없다. fs.write 가 폴더까지 만든다
      if (!(await $.fs.exists(dir))) await $.fs.write(`${dir}/.keep`, '')
      const files = (await $.fs.list(dir)).filter(en => en.kind === 'file')
      const stale = staleFiles(files, nowMs, sid)
      if (stale.length > 0) {
        await removeFiles($, stale)
      }
    } catch {
      // 폴더가 없거나 삭제 실패
    }

    await poll()
    $.clock.every(POLL_MS, poll)
    void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  })

  // /clear 를 쓰면 끝난 대화의 진행 파일을 바로 지운다
  on('session.end', async ($, e, next) => {
    const name = clearedFile(e.reason, e.sessionId)
    if (name) {
      try {
        await removeFiles($, [name])
      } catch {
        // 삭제 실패는 7일 정리에 맡긴다
      }
    }
    return next(e)
  })

  on('command.run', { command: 'progress' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: '작업 진행 창을 열었습니다.' }
  })

  // 사용자 요청과 백그라운드 완료 알림
  on('prompt.submit', async ($, e, next) => {
    const t = await $.clock.now()
    if (e.origin.kind === 'task-notification') {
      const done = parseNotification(e.text)
      if (done.length > 0) {
        await update($, jobs, list =>
          list.map(j => {
            const hit = done.find(d => d.toolUseId === j.id)
            return hit && j.endedAt === null ? { ...j, endedAt: t, result: hit.status } : j
          }),
        )
      }
    } else if (e.text.trim() !== '' && !e.text.trimStart().startsWith('<')) {
      await update($, request, () => ({ text: firstLine(e.text), summary: undefined, startedAt: t, endedAt: null }))
      await update($, jobs, list => trimJobs(list))
      await update($, failures, () => [])
      // 요청 해석은 기다리지 않는다. 메시지 전송을 늦추지 않고, 답이 오면 창만 다시 그린다
      void $.model
        .complete({ model: SUMMARY_MODEL, prompt: summaryPrompt(e.text), maxTokens: 200, effort: 'low', timeoutMs: 15000 })
        .then(r => (r.isAnswered ? cleanSummary(r.text) : null))
        .catch(() => null)
        .then(summary =>
          // 그 사이 새 요청이 들어왔으면 옛 답은 버린다
          update($, request, r => (r && r.startedAt === t ? { ...r, summary } : r)),
        )
        .catch(() => undefined)
      // 사용자 메시지마다 이 세션의 진행 파일 경로를 붙인다.
      // 시스템 프롬프트 절(prompt.compose)은 Claude 에게 보이지 않아 쓰지 않는다(2026-10-12 확인)
      const ctx = fileNotice(progressFile(dir, await $.session.id()))
      return next({ ...e, context: [...(e.context ?? []), ctx] })
    }
    return next(e)
  }).catch(($, e, next) => next(e)) // 기록에 실패해도 메시지는 그대로 보낸다

  on('agent.spawn', async ($, e, next) => {
    if (e.background && e.tool_use_id) backgroundAgents.add(e.tool_use_id)
    return next(e)
  }).catch(($, e, next) => next(e)) // 기록에 실패해도 에이전트는 그대로 띄운다

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      const t = await $.clock.now()
      await update($, request, r => (r && r.endedAt === null ? { ...r, endedAt: t } : r))
    }
    return next(e)
  })

  // 서브에이전트(전경, 백그라운드)와 백그라운드 셸 명령, 실패한 셸 명령
  on('tool.call', async ($, e, next) => {
    if (e.agentId) return next(e)
    const args = e as unknown as Record<string, unknown>
    const isAgent = e.tool === 'Agent'
    const isShell = e.tool === 'Bash' || e.tool === 'PowerShell'
    if (isShell && args.run_in_background !== true) {
      const ran = await next(e)
      if ('isError' in ran && ran.isError === true) {
        const command = typeof args.command === 'string' ? args.command : ''
        const label = typeof args.description === 'string' && args.description ? args.description : oneLine(command, 80)
        const at = await $.clock.now()
        const error = errorLine(typeof ran.text === 'string' ? ran.text : '')
        await update($, failures, list => addFailure(list, { command, label, lastAt: at, error }))
      }
      return ran
    }
    if (!isAgent && !isShell) return next(e)

    const t = await $.clock.now()
    const id = e.tool_use_id ?? `${e.tool}-${t}`
    const label = typeof args.description === 'string' && args.description ? args.description : e.tool
    const job: Job = { id, kind: isAgent ? 'agent' : 'shell', label, startedAt: t, endedAt: null, result: null }
    await update($, jobs, list => trimJobs([...list, job]))

    try {
      const ran = await next(e)
      const failed = 'deny' in ran || ('isError' in ran && ran.isError === true)
      const background = ranInBackground(isAgent, args, backgroundAgents, id)
      backgroundAgents.delete(id)
      // 백그라운드 작업은 완료 알림(prompt.submit)이 끝낸다
      if (!background || failed) {
        const end = await $.clock.now()
        await update($, jobs, list =>
          list.map(j => (j.id === id ? { ...j, endedAt: end, result: failed ? 'failed' : 'completed' } : j)),
        )
      }
      return ran
    } catch (err) {
      const end = await $.clock.now()
      await update($, jobs, list => list.map(j => (j.id === id ? { ...j, endedAt: end, result: 'failed' } : j)))
      throw err
    }
  }).catch(($, e, next) => next(e)) // 기록에 실패해도 도구 호출은 막지 않는다. 이미 실행됐으면 그 결과를 그대로 돌려준다

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const p = await read($, data)
    const mtime = await read($, fileTime)
    const nowMs = await read($, now)
    const req = await read($, request)
    const list = await read($, jobs)
    const fails = await read($, failures)
    const failTotal = fails.reduce((s, f) => s + f.count, 0)
    const width = Math.max(6, Math.min(20, (e.props.bodyColumns ?? 40) - 22))
    const textMax = Math.max(20, (e.props.bodyColumns ?? 40) - 4)

    const running = list.filter(j => j.endedAt === null)
    const finished = list.filter(j => j.endedAt !== null)
    const file = showFile(p, mtime, req) ? p : null

    const current = file ? file.tasks.filter(t => t.status !== 'next') : []
    const upcoming = file ? file.tasks.filter(t => t.status === 'next') : []
    const overall = file && file.tasks.length
      ? Math.round(file.tasks.reduce((s, t) => s + percentOf(t), 0) / file.tasks.length)
      : 0
    const left = file ? file.tasks.filter(t => t.status !== 'done').map(t => remainingSec(t, nowMs)) : []
    const totalLeft = left.some(s => s === null) ? null : left.reduce((a, b) => a! + b!, 0)

    return (
      <Box flexDirection="column">
        {/* 진행 단계와 다음 작업을 맨 위에 둔다. 현재 요청, 백그라운드 작업은 그 아래 */}
        {file && (
          <Box flexDirection="column">
            {file.title && <Text bold>{oneLine(file.title, textMax)}</Text>}
            <Text>
              전체 {bar(overall, width)} {overall}%
            </Text>
            <Text dimColor>남은 시간 {fmtSec(totalLeft)}</Text>
            {current.map(t => (
              <Box flexDirection="column">
                <Text bold={t.status === 'running'} dimColor={t.status === 'done'}>
                  {t.status === 'done' ? '✔' : '▶'} {oneLine(t.name, textMax)}
                </Text>
                <Text dimColor={t.status === 'done'}>
                  {'  '}
                  {bar(percentOf(t), width)} {percentOf(t)}%
                  {t.status === 'running' ? `  남은 ${fmtSec(remainingSec(t, nowMs))}` : ''}
                </Text>
                {t.note && <Text dimColor>{'  '}{oneLine(t.note, textMax - 2)}</Text>}
              </Box>
            ))}
            {upcoming.length > 0 && (
              <Box flexDirection="column">
                <Text> </Text>
                <Text bold>▼ 다음 작업</Text>
                {upcoming.map((t, i) => (
                  <Box flexDirection="column">
                    <Text>
                      {'  '}
                      {oneLine(t.name, textMax - 2)}
                      {typeof t.etaSec === 'number' ? `  (${fmtSec(t.etaSec)})` : ''}
                    </Text>
                    {i < upcoming.length - 1 && <Text dimColor>{'    ↓'}</Text>}
                  </Box>
                ))}
              </Box>
            )}
            <Text> </Text>
          </Box>
        )}

        <Text bold>현재 요청</Text>
        {req ? (
          <Box flexDirection="column">
            {/* 현재 요청은 자르지 않고 창 폭에서 줄을 바꿔 전부 보여준다 */}
            <Text dimColor={req.endedAt !== null} wrap="wrap">
              {req.endedAt === null ? '▶' : '✔'} {firstLine(requestLabel(req))}
            </Text>
            <Text dimColor>
              {'  '}
              {req.endedAt === null
                ? `진행 ${fmtElapsed(nowMs - req.startedAt)}`
                : `완료 (${fmtElapsed(req.endedAt - req.startedAt)})`}
            </Text>
          </Box>
        ) : (
          <Text dimColor>아직 없음</Text>
        )}

        {/* 실패한 명령은 있을 때만 보인다. 같은 명령이 여러 번 실패하면 횟수가 오른다 */}
        {fails.length > 0 && (
          <Box flexDirection="column">
            <Text> </Text>
            <Text bold color="error">실패한 명령 {failTotal}회</Text>
            {fails.map(f => (
              <Box flexDirection="column">
                <Text color={f.count > 1 ? 'error' : undefined}>
                  ✘ {f.count}회 {oneLine(f.label, textMax - 6)}
                </Text>
                {f.error && <Text dimColor>{'  '}{oneLine(f.error, textMax - 2)}</Text>}
              </Box>
            ))}
          </Box>
        )}

        <Text> </Text>
        <Text bold>백그라운드 작업</Text>
        {list.length === 0 && <Text dimColor>없음</Text>}
        {running.map(j => (
          <Text>
            ▶ {j.kind === 'agent' ? '에이전트' : '명령'} {oneLine(j.label, textMax - 18)}  {fmtElapsed(nowMs - j.startedAt)}
          </Text>
        ))}
        {finished.map(j => (
          <Text dimColor>
            {j.result === 'completed' ? '✔' : '✘'} {oneLine(j.label, textMax - 14)}  {fmtElapsed((j.endedAt ?? nowMs) - j.startedAt)}
          </Text>
        ))}
      </Box>
    )
  })
}
