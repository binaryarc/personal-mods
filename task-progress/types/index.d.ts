export type TaskStatus = 'done' | 'running' | 'next'

/** 진행 상황 파일(task-progress.json)의 한 단계. Claude 가 적는다 */
export type Task = {
  name: string
  status: TaskStatus
  /** 0~100. 없으면 done=100, next=0, running=0 으로 본다 */
  percent?: number
  /** 시작 시각(epoch ms). running 이고 etaSec 가 없으면 이 값과 percent 로 남은 시간을 계산한다 */
  startedAt?: number
  /** 예상 남은 시간(초). 주어지면 계산값보다 우선한다 */
  etaSec?: number
  /** 한 줄 부연 */
  note?: string
}

export type Progress = {
  title?: string
  tasks: Task[]
}

/** 사용자가 보낸 현재 요청. 이벤트로 자동 기록한다 */
export type Request = {
  /** 사용자가 보낸 원문 첫 줄. 해석에 실패했을 때만 보인다 */
  text: string
  /** 모델이 요청을 해석해 한 줄로 적은 것. undefined 는 해석 중, null 은 해석 실패 */
  summary?: string | null
  startedAt: number
  endedAt: number | null
}

/** 서브에이전트, 백그라운드 명령. 도구 호출과 완료 알림으로 자동 기록한다 */
export type Job = {
  id: string
  kind: 'agent' | 'shell'
  label: string
  startedAt: number
  endedAt: number | null
  /** 완료 알림의 status (completed, failed, killed) */
  result: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'task-progress': {
      data: Progress | null
      /** 진행 상황 파일의 수정 시각(epoch ms) */
      fileTime: number
      now: number
      error: string | null
      request: Request | null
      jobs: Job[]
    }
  }
}
