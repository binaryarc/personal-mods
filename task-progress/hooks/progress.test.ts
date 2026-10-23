import { expect, test } from 'claude-code/testing'

import {
  addFailure,
  bar,
  cleanSummary,
  clearedFile,
  errorLine,
  fmtElapsed,
  fmtSec,
  oneLine,
  parseNotification,
  percentOf,
  progressDir,
  progressFile,
  fileNotice,
  ranInBackground,
  remainingSec,
  requestLabel,
  showFile,
  summaryPrompt,
  staleFiles,
  TTL_MS,
  trimJobs,
} from './register'

test('진행률 기본값: done 100, next 0', () => {
  expect(percentOf({ name: 'a', status: 'done' })).toBe(100)
  expect(percentOf({ name: 'b', status: 'next' })).toBe(0)
  expect(percentOf({ name: 'c', status: 'running', percent: 140 })).toBe(100)
})

test('남은 시간: etaSec 우선, 없으면 경과시간 비례', () => {
  expect(remainingSec({ name: 'a', status: 'running', etaSec: 90 }, 0)).toBe(90)
  // 60초 동안 25% → 남은 75% 는 180초
  expect(remainingSec({ name: 'b', status: 'running', percent: 25, startedAt: 0 }, 60_000)).toBe(180)
  expect(remainingSec({ name: 'c', status: 'running', percent: 0, startedAt: 0 }, 60_000)).toBe(null)
  expect(remainingSec({ name: 'd', status: 'done' }, 0)).toBe(0)
})

test('표시 형식', () => {
  expect(fmtSec(null)).toBe('계산 중')
  expect(fmtSec(45)).toBe('45초')
  expect(fmtSec(300)).toBe('약 5분')
  expect(bar(50, 10)).toBe('█████░░░░░')
  expect(fmtElapsed(65_000)).toBe('1:05')
  expect(fmtElapsed(3_725_000)).toBe('1:02:05')
  expect(oneLine('\n  첫 줄입니다\n둘째 줄', 80)).toBe('첫 줄입니다')
  expect(oneLine('가나다라마바사', 5)).toBe('가나다라…')
})

test('완료 알림에서 tool_use_id 와 상태를 뽑는다', () => {
  const text =
    '<task-notification>\n<task-id>a1</task-id>\n<tool-use-id>toolu_A</tool-use-id>\n<status>completed</status>\n</task-notification>' +
    '<task-notification><tool-use-id>toolu_B</tool-use-id><status>failed</status></task-notification>'
  expect(parseNotification(text)).toEqual([
    { toolUseId: 'toolu_A', status: 'completed' },
    { toolUseId: 'toolu_B', status: 'failed' },
  ])
  expect(parseNotification('일반 요청')).toEqual([])
})

test('끝난 작업은 최근 5개만, 진행 중은 모두 남긴다', () => {
  const done = Array.from({ length: 7 }, (_, i) => ({
    id: `d${i}`, kind: 'agent' as const, label: `d${i}`, startedAt: 0, endedAt: 1, result: 'completed',
  }))
  const run = { id: 'r', kind: 'shell' as const, label: 'r', startedAt: 0, endedAt: null, result: null }
  const out = trimJobs([...done, run])
  expect(out.length).toBe(6)
  expect(out[0]?.id).toBe('d2')
  expect(out[5]?.id).toBe('r')
})

test('진행 상황 파일은 지금 요청 중에 고쳐졌거나 진행 중 단계가 있을 때만 보인다', () => {
  const allDone = { tasks: [{ name: 'a', status: 'done' as const }] }
  const req = { text: 'x', startedAt: 1000, endedAt: null }
  expect(showFile(allDone, 500, req)).toBe(false)
  expect(showFile(allDone, 1500, req)).toBe(true)
  expect(showFile({ tasks: [{ name: 'b', status: 'running' as const }] }, 500, req)).toBe(true)
  expect(showFile(null, 1500, req)).toBe(false)
})

test('진행 폴더: USERPROFILE 우선, 역슬래시는 슬래시로, 없으면 HOME', () => {
  expect(progressDir('C:\\Users\\kim', '/ignored')).toBe('C:/Users/kim/.claude/task-progress')
  expect(progressDir(undefined, '/home/lee/')).toBe('/home/lee/.claude/task-progress')
})

test('세션별 파일: 세션 ID 마다 다른 경로', () => {
  const d = 'C:/Users/kim/.claude/task-progress'
  expect(progressFile(d, 'aaa')).toBe('C:/Users/kim/.claude/task-progress/aaa.json')
  expect(progressFile(d, 'aaa')).not.toBe(progressFile(d, 'bbb'))
})

test('메시지 안내문에 이 세션의 파일 경로와 쓰는 법이 들어간다', () => {
  const notice = fileNotice('C:/Users/kim/.claude/task-progress/abc.json')
  expect(notice.includes('C:/Users/kim/.claude/task-progress/abc.json')).toBe(true)
  expect(notice.includes('etaSec 는 next 단계에만')).toBe(true)
})

test('백그라운드 판단: 에이전트는 agent.spawn 기록, 셸은 run_in_background', () => {
  const spawned = new Set(['bg-agent'])
  // 에이전트 호출 인자에는 run_in_background 가 없다. 호출이 돌아와도 완료로 찍으면 안 된다
  expect(ranInBackground(true, {}, spawned, 'bg-agent')).toBe(true)
  expect(ranInBackground(true, {}, spawned, 'fg-agent')).toBe(false)
  expect(ranInBackground(false, { run_in_background: true }, spawned, 'sh-1')).toBe(true)
  expect(ranInBackground(false, {}, spawned, 'sh-2')).toBe(false)
})

test('7일 지난 다른 세션 파일만 지울 대상이다', () => {
  const now = 100 * 24 * 60 * 60 * 1000
  const files = [
    { name: 'old.json', mtimeMs: now - TTL_MS - 1 },
    { name: 'fresh.json', mtimeMs: now - TTL_MS + 1 },
    { name: 'me.json', mtimeMs: now - TTL_MS * 3 },
    { name: 'note.txt', mtimeMs: 0 },
  ]
  expect(staleFiles(files, now, 'me')).toEqual(['old.json'])
  expect(TTL_MS).toBe(7 * 24 * 60 * 60 * 1000)
})

test('/clear 로 끝난 세션만 그 파일을 지운다', () => {
  expect(clearedFile('clear', 'abc')).toBe('abc.json')
  expect(clearedFile('prompt_input_exit', 'abc')).toBe(null)
  expect(clearedFile('resume', 'abc')).toBe(null)
})

test('요청 해석 질문: 원문은 request 태그 안에, 길면 자른다', () => {
  const p = summaryPrompt('오른쪽 패널 이름 바꿔줘')
  expect(p.includes('<request>\n오른쪽 패널 이름 바꿔줘\n</request>')).toBe(true)
  expect(summaryPrompt('가'.repeat(5000)).includes('가'.repeat(2001))).toBe(false)
})

test('해석 답 정리: 첫 줄만, 따옴표 제거, 비면 null', () => {
  expect(cleanSummary('"플러그인 이름 변경하기"\n부연')).toBe('플러그인 이름 변경하기')
  expect(cleanSummary('  \n ')).toBe(null)
})

test('창 문구: 해석 문장, 해석 중, 실패 시 원문', () => {
  const base = { text: '원문', startedAt: 0, endedAt: null }
  expect(requestLabel({ ...base, summary: '해석 문장' })).toBe('해석 문장')
  expect(requestLabel({ ...base })).toBe('요청 해석 중…')
  expect(requestLabel({ ...base, summary: null })).toBe('원문')
})

test('오류 한 줄: Exit code 줄은 건너뛰고 원인 줄을 쓴다', () => {
  expect(errorLine('Exit code 1\n\ngrep: x: No such file')).toBe('grep: x: No such file')
  expect(errorLine('Exit code 2')).toBe('Exit code 2')
  expect(errorLine('')).toBe('')
})

test('실패한 명령: 같은 명령은 횟수를 올리고 최근 5개만 남긴다', () => {
  const f = (command: string, at: number) => ({ command, label: command, lastAt: at, error: 'e' })
  let list = addFailure([], f('a', 1))
  list = addFailure(list, f('b', 2))
  list = addFailure(list, f('a', 3))
  expect(list.map(x => `${x.command}${x.count}`)).toEqual(['b1', 'a2'])
  for (const c of ['c', 'd', 'e', 'g']) list = addFailure(list, f(c, 4))
  expect(list.map(x => x.command)).toEqual(['a', 'c', 'd', 'e', 'g'])
})
