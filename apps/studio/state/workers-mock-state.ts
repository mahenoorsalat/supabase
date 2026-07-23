import { useMemo } from 'react'
import { proxy, useSnapshot } from 'valtio'

import type {
  Worker,
  WorkerLifecycleEvent,
  WorkerLogLine,
} from '@/components/interfaces/Workers/Workers.types'
import {
  WORKER_INSTANCE_LIMITS,
  WORKER_MOCK_TIMERS,
  WORKER_REGION,
  WORKER_STATE_LABELS,
  type WorkerAccessMode,
  type WorkerLifecycleState,
  type WorkerRuntimeId,
  type WorkerSizeId,
} from '@/lib/constants/workers'

/**
 * There is no real Workers backend at alpha, so the dashboard is driven by
 * this valtio proxy store instead of react-query. It mirrors the
 * `sidebar-manager-state` pattern (proxy + useSnapshot hooks).
 *
 * Ordering convention: both `logs` and `lifecycle` are stored NEWEST-FIRST
 * (index 0 = most recent). Every mutation prepends with `.unshift()`. Preserve
 * this — the lifecycle and log feed render straight off index order.
 */

export const WORKERS_PROJECT_INSTANCE_CAP = WORKER_INSTANCE_LIMITS.projectCap

const HISTORY_LIMITS = { logs: 40, lifecycle: 20 } as const

let idCounter = 0
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`

const nowIso = () => new Date().toISOString()
const isoSecondsAgo = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString()

const REQUEST_PATHS = ['/', '/health', '/webhook', '/api/tasks', '/api/embed', '/render']
const REQUEST_METHODS = ['GET', 'POST', 'POST', 'GET', 'PUT']

const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]

const makeRequestLog = (offsetSeconds = 0): WorkerLogLine => {
  const status = Math.random() > 0.92 ? pick([500, 502, 401]) : pick([200, 200, 200, 201, 204])
  return {
    id: nextId('log'),
    timestamp: isoSecondsAgo(offsetSeconds),
    level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
    kind: 'request',
    message: '',
    method: pick(REQUEST_METHODS),
    path: pick(REQUEST_PATHS),
    status,
    durationMs: Math.round(8 + Math.random() * 120),
  }
}

const makeStdoutLog = (message: string, offsetSeconds = 0): WorkerLogLine => ({
  id: nextId('log'),
  timestamp: isoSecondsAgo(offsetSeconds),
  level: 'info',
  kind: 'stdout',
  message,
})

const makeLifecycleLog = (
  state: WorkerLifecycleState,
  offsetSeconds = 0,
  note?: string
): WorkerLogLine => ({
  id: nextId('log'),
  timestamp: isoSecondsAgo(offsetSeconds),
  level: state === 'errored' ? 'error' : 'info',
  kind: 'lifecycle',
  state,
  message: note ?? `Worker ${WORKER_STATE_LABELS[state].toLowerCase()}`,
})

const makeLifecycleEvent = (
  state: WorkerLifecycleState,
  offsetSeconds = 0,
  note?: string
): WorkerLifecycleEvent => ({
  id: nextId('lc'),
  timestamp: isoSecondsAgo(offsetSeconds),
  state,
  note,
})

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

export interface CreateWorkerInput {
  name: string
  runtime: WorkerRuntimeId
  size: WorkerSizeId
  access: WorkerAccessMode
  instances: number
}

type WorkersMockData = {
  workers: Worker[]
}

type WorkersMockState = WorkersMockData & {
  createWorker: (input: CreateWorkerInput) => Worker
  simulateTraffic: (id: string) => void
  suspendWorker: (id: string) => void
  resumeWorker: (id: string) => void
  deleteWorker: (id: string) => void
}

/** A friendly, unique-ish default name for the create form. */
export const generateWorkerName = () => `worker-${Math.floor(100000 + Math.random() * 899999)}`

const trimHistory = (worker: Worker) => {
  if (worker.logs.length > HISTORY_LIMITS.logs) worker.logs.length = HISTORY_LIMITS.logs
  if (worker.lifecycle.length > HISTORY_LIMITS.lifecycle)
    worker.lifecycle.length = HISTORY_LIMITS.lifecycle
}

const transition = (worker: Worker, state: WorkerLifecycleState, note?: string) => {
  worker.state = state
  worker.lifecycle.unshift(makeLifecycleEvent(state, 0, note))
  worker.logs.unshift(makeLifecycleLog(state, 0, note))
  trimHistory(worker)
}

const uniqueSlug = (name: string) => {
  const base = slugify(name) || 'worker'
  let slug = base
  let n = 2
  while (workersMockState.workers.some((w) => w.slug === slug)) slug = `${base}-${n++}`
  return slug
}

export const workersMockState: WorkersMockState = proxy<WorkersMockState>({
  // Demo starts empty — the first worker is created from the UI.
  workers: [],

  createWorker(input: CreateWorkerInput) {
    const slug = uniqueSlug(input.name)
    const endpoint =
      input.access === 'public' ? `https://workers.supabase.co/v1/${slug}` : undefined

    const worker: Worker = {
      id: nextId('wkr'),
      slug,
      name: input.name || slug,
      runtime: input.runtime,
      size: input.size,
      access: input.access,
      state: 'deploying',
      region: WORKER_REGION.id,
      instances: input.instances,
      createdAt: nowIso(),
      createdBy: { type: 'user', name: 'you@supabase.io' },
      idleSeconds: 0,
      endpoint,
      logs: [makeLifecycleLog('deploying', 0, 'Deploy started from dashboard')],
      lifecycle: [makeLifecycleEvent('deploying', 0, 'Deploy started from dashboard')],
    }
    workersMockState.workers.unshift(worker)

    // Simulate the build finishing and the worker coming up.
    const newId = worker.id
    setTimeout(() => {
      const w = workersMockState.workers.find((x) => x.id === newId)
      if (!w || w.state !== 'deploying') return
      transition(w, 'active', 'Build complete, worker is live')
      if (w.access === 'public') w.logs.unshift(makeRequestLog(0))
      trimHistory(w)
    }, WORKER_MOCK_TIMERS.resumingDurationMs)

    return worker
  },

  simulateTraffic(id: string) {
    const worker = workersMockState.workers.find((w) => w.id === id)
    if (!worker || worker.state === 'killed' || worker.state === 'deploying') return

    if (worker.state === 'suspended') {
      transition(worker, 'resuming', 'Traffic received, waking worker')
      const resumingId = worker.id
      setTimeout(() => {
        const w = workersMockState.workers.find((x) => x.id === resumingId)
        if (!w || w.state !== 'resuming') return
        w.idleSeconds = 0
        transition(w, 'active', 'Cold start complete in 0.9s')
        if (w.access === 'public') w.logs.unshift(makeRequestLog(0))
        trimHistory(w)
      }, WORKER_MOCK_TIMERS.resumingDurationMs)
      return
    }

    if (worker.state === 'active' || worker.state === 'errored') {
      if (worker.state === 'errored') transition(worker, 'active', 'Recovered after redeploy')
      worker.idleSeconds = 0
      if (worker.access === 'public') worker.logs.unshift(makeRequestLog(0))
      else worker.logs.unshift(makeStdoutLog('Handled inbound event', 0))
      trimHistory(worker)
    }
  },

  suspendWorker(id: string) {
    const worker = workersMockState.workers.find((w) => w.id === id)
    if (!worker || worker.state !== 'active') return
    transition(worker, 'draining', 'Suspend requested, finishing in-flight requests')
    const wid = worker.id
    setTimeout(() => {
      const w = workersMockState.workers.find((x) => x.id === wid)
      if (!w || w.state !== 'draining') return
      transition(w, 'suspended', 'Scaled to zero — $0 while idle')
    }, WORKER_MOCK_TIMERS.drainingDurationMs)
  },

  resumeWorker(id: string) {
    const worker = workersMockState.workers.find((w) => w.id === id)
    if (!worker || (worker.state !== 'suspended' && worker.state !== 'errored')) return
    transition(
      worker,
      'resuming',
      worker.state === 'errored' ? 'Restart requested' : 'Resume requested'
    )
    const wid = worker.id
    setTimeout(() => {
      const w = workersMockState.workers.find((x) => x.id === wid)
      if (!w || w.state !== 'resuming') return
      w.idleSeconds = 0
      transition(w, 'active', 'Cold start complete in 0.9s')
      if (w.access === 'public') w.logs.unshift(makeRequestLog(0))
      trimHistory(w)
    }, WORKER_MOCK_TIMERS.resumingDurationMs)
  },

  deleteWorker(id: string) {
    const index = workersMockState.workers.findIndex((w) => w.id === id)
    if (index === -1) return
    workersMockState.workers.splice(index, 1)
  },
})

// ---------------------------------------------------------------------------
// Lifecycle ticker — lazily started, idempotent. Ages idle workers toward
// suspend and injects the occasional bit of background traffic so the fleet
// realistically fluctuates instead of flatlining during a demo.
// ---------------------------------------------------------------------------

let tickerStarted = false

export const ensureWorkersMockTicker = () => {
  if (tickerStarted || typeof window === 'undefined') return
  tickerStarted = true

  setInterval(() => {
    const tickSeconds = WORKER_MOCK_TIMERS.tickMs / 1000

    workersMockState.workers.forEach((worker) => {
      if (worker.state === 'active') {
        // ~20% chance of background traffic per active worker per tick.
        if (Math.random() < 0.2) {
          worker.idleSeconds = 0
          if (worker.access === 'public') worker.logs.unshift(makeRequestLog(0))
          else worker.logs.unshift(makeStdoutLog('Handled inbound event', 0))
          trimHistory(worker)
          return
        }

        worker.idleSeconds += tickSeconds
        if (worker.idleSeconds >= WORKER_MOCK_TIMERS.idleThresholdSeconds) {
          transition(worker, 'draining', 'Idle threshold reached, finishing in-flight requests')
          const drainingId = worker.id
          setTimeout(() => {
            const w = workersMockState.workers.find((x) => x.id === drainingId)
            if (!w || w.state !== 'draining') return
            transition(w, 'suspended', 'Scaled to zero — $0 while idle')
          }, WORKER_MOCK_TIMERS.drainingDurationMs)
        }
      } else if (worker.state === 'suspended') {
        worker.idleSeconds += tickSeconds
      }
    })
  }, WORKER_MOCK_TIMERS.tickMs)
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export const useWorkersFleet = () => {
  const snap = useSnapshot(workersMockState)
  return snap.workers as Worker[]
}

export const useWorkerBySlug = (slug?: string) => {
  const snap = useSnapshot(workersMockState)
  return useMemo(
    () => (snap.workers as Worker[]).find((w) => w.slug === slug),
    [snap.workers, slug]
  )
}

export const useInstancesUsed = () => {
  const snap = useSnapshot(workersMockState)
  return useMemo(
    () => (snap.workers as Worker[]).reduce((sum, w) => sum + w.instances, 0),
    [snap.workers]
  )
}
