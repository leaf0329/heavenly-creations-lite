import { getJobDefinition } from './job-registry'
import {
  getPendingJobs,
  recoverExpiredJobs,
  sttConcurrencyLimit,
  textConcurrencyLimit,
} from './jobs'
import { tryProcessJob } from './process-job'

type ActiveJob = { userId: string; handler: 'text' | 'stt' }

const state = globalThis as typeof globalThis & {
  __hclite_text_queue?: {
    started: boolean
    timer: NodeJS.Timeout | null
    pumping: boolean
    active: Map<string, ActiveJob>
  }
}

if (!state.__hclite_text_queue) {
  state.__hclite_text_queue = {
    started: false,
    timer: null,
    pumping: false,
    active: new Map(),
  }
}
const queue = state.__hclite_text_queue

function activeForUser(userId: string, handler: 'text' | 'stt'): number {
  let count = 0
  for (const active of queue.active.values()) if (active.userId === userId && active.handler === handler) count++
  return count
}

export async function pumpJobQueue(): Promise<void> {
  if (queue.pumping) return
  queue.pumping = true
  try {
    // Let the database lease watchdog recover even a job whose local promise
    // was lost (the in-process map cannot be trusted after a crash/hang).
    await recoverExpiredJobs()
    const pending = await getPendingJobs(200)
    for (const job of pending) {
      if (queue.active.has(job.id)) continue
      const definition = getJobDefinition(job.type)
      // The database check prevents this in normal operation.  Keep the
      // guard here so a hand-written row can never be sent to another worker.
      if (!definition || definition.queueKind !== 'text') continue
      const limit = definition.handler === 'stt' ? sttConcurrencyLimit() : textConcurrencyLimit()
      if (activeForUser(job.userId, definition.handler) >= limit) continue
      queue.active.set(job.id, { userId: job.userId, handler: definition.handler })
      void tryProcessJob(job.id)
        .catch((error) => {
          console.error(`[hclite/queue] 任务执行异常 ${job.id.slice(0, 8)}`, error instanceof Error ? error.message : error)
        })
        .finally(() => {
          queue.active.delete(job.id)
          queueMicrotask(() => { void pumpJobQueue() })
        })
    }
  } finally {
    queue.pumping = false
  }
}

export function startJobQueue(): void {
  if (queue.started) return
  queue.started = true
  queue.timer = setInterval(() => { void pumpJobQueue() }, 2_000)
  queue.timer.unref?.()
  void pumpJobQueue()
}

export function enqueueJob(): void {
  startJobQueue()
  queueMicrotask(() => { void pumpJobQueue() })
}

export function stopJobQueue(): void {
  if (queue.timer) clearInterval(queue.timer)
  queue.timer = null
  queue.started = false
  queue.active.clear()
}

export function getQueueStatus(): { active: number; text: number; stt: number; byUser: Record<string, number> } {
  const byUser: Record<string, number> = {}
  for (const active of queue.active.values()) byUser[active.userId] = (byUser[active.userId] || 0) + 1
  let text = 0
  let stt = 0
  for (const active of queue.active.values()) {
    if (active.handler === 'stt') stt++
    else text++
  }
  return { active: queue.active.size, text, stt, byUser }
}
