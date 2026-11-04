import { join } from 'node:path'
import { PdfRenderError } from './errors'
import type { RenderRequest, RenderResponse } from './protocol'

/**
 * The `outcome` label of `pdf_renders_total` (observability §4.8, DOC-34 §14, DR-291). The pool
 * only ever renders; `cached` is decided above it.
 */
export type RenderOutcome = 'rendered' | 'failed'

/**
 * The `reason` label of `pdf_renderer_restarts_total` (observability §4.8, DOC-34 §14, DR-291):
 * `documents` = `maxDocuments`, `rss` = `maxRssMb`, `timeout` = `renderTimeoutMs`, `crash` = the
 * host exited by itself. `idle` is not a metric label; the observer still carries it.
 */
export type RenderRestartReason = 'documents' | 'rss' | 'timeout' | 'crash' | 'idle'

export interface RenderHostObserver {
  /** Called once for every request that reached a host (DOC-34 §4.1). */
  rendered(kind: string, outcome: RenderOutcome, seconds: number): void
  /** Called once for every host lifecycle event that ends a host (DOC-34 §4.1). */
  restarted(reason: RenderRestartReason): void
}

export interface RenderHostPoolOptions {
  templatesModule: string
  size: number
  maxDocuments?: number
  maxRssMb?: number
  renderTimeoutMs?: number
  waitTimeoutMs?: number
  idleExitMs?: number
  observer?: RenderHostObserver
  onLog?: (event: string, fields: Record<string, unknown>) => void
}

export interface RenderHostPool {
  render(kind: string, input: unknown): Promise<Uint8Array>
  close(): Promise<void>
}

interface PendingRender {
  id: number
  kind: string
  input: unknown
  enqueuedAt: number
  renderStartedAt: number
  waitTimer?: ReturnType<typeof setTimeout>
  resolve(bytes: Uint8Array): void
  reject(error: Error): void
}

interface Host {
  proc: Bun.Subprocess
  busy: boolean
  documents: number
  retired: boolean
  pending?: PendingRender
  renderTimer?: ReturnType<typeof setTimeout>
  idleTimer?: ReturnType<typeof setTimeout>
}

const MIB = 1024 * 1024

/**
 * The render-host pool (DOC-34 §4.1, §4.2, §10, DR-291). Hosts start lazily on the first render.
 * A free host takes a request and the rest queue FIFO. A render recycles a host that served
 * `maxDocuments` documents, or whose RSS passed `maxRssMb`; a render past `renderTimeoutMs`, or a
 * host exit, fails the pending render and replaces the host. The parent never renders.
 */
export function createRenderHostPool(options: RenderHostPoolOptions): RenderHostPool {
  const {
    templatesModule,
    size,
    maxDocuments = 150,
    maxRssMb = 400,
    renderTimeoutMs = 30_000,
    waitTimeoutMs,
    idleExitMs,
    observer,
    onLog,
  } = options
  const mainPath = join(import.meta.dir, 'main.ts')
  const hosts: Host[] = []
  const queue: PendingRender[] = []
  let nextId = 1
  let closed = false

  function startHost(): void {
    const host = { busy: false, documents: 0, retired: false } as Host
    host.proc = Bun.spawn([process.execPath, mainPath, templatesModule], {
      ipc: (message) => onMessage(host, message as RenderResponse),
      serialization: 'advanced',
    })
    hosts.push(host)
    onLog?.('pdf.host_start', { pid: host.proc.pid })
    void host.proc.exited.then(() => onExit(host))
  }

  function onMessage(host: Host, response: RenderResponse): void {
    const request = host.pending
    if (!request || request.id !== response.id) return
    clearRenderTimer(host)
    host.pending = undefined
    host.busy = false
    settle(request, response)
    host.documents++
    const exhausted = host.documents >= maxDocuments
    const heavy = response.ok && response.rssBytes > maxRssMb * MIB
    if (exhausted || heavy) {
      retire(host, exhausted ? 'documents' : 'rss')
    } else {
      scheduleIdle(host)
      pump()
    }
  }

  function settle(request: PendingRender, response: RenderResponse): void {
    const seconds = since(request.renderStartedAt)
    if (response.ok) {
      observer?.rendered(request.kind, 'rendered', seconds)
      request.resolve(response.bytes)
    } else {
      observer?.rendered(request.kind, 'failed', seconds)
      request.reject(new PdfRenderError('render_failed', response.message))
    }
  }

  function onRenderTimeout(host: Host): void {
    const request = host.pending
    if (!request) return
    host.pending = undefined
    host.busy = false
    observer?.rendered(request.kind, 'failed', since(request.renderStartedAt))
    request.reject(new PdfRenderError('timeout'))
    retire(host, 'timeout')
  }

  function onExit(host: Host): void {
    if (host.retired) return
    const request = host.pending
    host.retired = true
    removeHost(host)
    clearTimers(host)
    onLog?.('pdf.host_exit', { pid: host.proc.pid })
    observer?.restarted('crash')
    if (request) {
      observer?.rendered(request.kind, 'failed', since(request.renderStartedAt))
      request.reject(new PdfRenderError('host_exited'))
    }
    pump()
  }

  function onWaitTimeout(request: PendingRender): void {
    const index = queue.indexOf(request)
    if (index < 0) return
    queue.splice(index, 1)
    onLog?.('pdf.busy', { kind: request.kind })
    request.reject(new PdfRenderError('busy'))
  }

  function dispatch(host: Host, request: PendingRender): void {
    host.busy = true
    host.pending = request
    clearIdleTimer(host)
    clearWaitTimer(request)
    request.renderStartedAt = performance.now()
    host.renderTimer = setTimeout(() => onRenderTimeout(host), renderTimeoutMs)
    const message: RenderRequest = { id: request.id, kind: request.kind, input: request.input }
    host.proc.send(message)
  }

  function pump(): void {
    if (closed) return
    while (queue.length > 0) {
      const host = hosts.find((candidate) => !candidate.busy)
      if (host) {
        const request = queue.shift()
        if (request) dispatch(host, request)
        continue
      }
      if (hosts.length >= size) return
      startHost()
    }
  }

  function retire(host: Host, reason: RenderRestartReason): void {
    host.retired = true
    removeHost(host)
    clearTimers(host)
    onLog?.('pdf.host_retire', { pid: host.proc.pid, reason })
    observer?.restarted(reason)
    host.proc.kill('SIGKILL')
    pump()
  }

  function scheduleIdle(host: Host): void {
    if (idleExitMs === undefined) return
    host.idleTimer = setTimeout(() => retire(host, 'idle'), idleExitMs)
  }

  function removeHost(host: Host): void {
    const index = hosts.indexOf(host)
    if (index >= 0) hosts.splice(index, 1)
  }

  function clearRenderTimer(host: Host): void {
    if (!host.renderTimer) return
    clearTimeout(host.renderTimer)
    host.renderTimer = undefined
  }

  function clearIdleTimer(host: Host): void {
    if (!host.idleTimer) return
    clearTimeout(host.idleTimer)
    host.idleTimer = undefined
  }

  function clearWaitTimer(request: PendingRender): void {
    if (!request.waitTimer) return
    clearTimeout(request.waitTimer)
    request.waitTimer = undefined
  }

  function clearTimers(host: Host): void {
    clearRenderTimer(host)
    clearIdleTimer(host)
  }

  function render(kind: string, input: unknown): Promise<Uint8Array> {
    if (closed) return Promise.reject(new PdfRenderError('host_exited'))
    return new Promise((resolve, reject) => {
      const request: PendingRender = {
        id: nextId++,
        kind,
        input,
        enqueuedAt: performance.now(),
        renderStartedAt: 0,
        resolve,
        reject,
      }
      if (waitTimeoutMs !== undefined) {
        request.waitTimer = setTimeout(() => onWaitTimeout(request), waitTimeoutMs)
      }
      queue.push(request)
      pump()
    })
  }

  async function close(): Promise<void> {
    if (closed) return
    closed = true
    for (const request of queue) {
      clearWaitTimer(request)
      request.reject(new PdfRenderError('host_exited'))
    }
    queue.length = 0
    const exits: Promise<number>[] = []
    for (const host of [...hosts]) {
      const request = host.pending
      host.retired = true
      clearTimers(host)
      if (request) {
        observer?.rendered(request.kind, 'failed', since(request.renderStartedAt))
        request.reject(new PdfRenderError('host_exited'))
      }
      onLog?.('pdf.host_retire', { pid: host.proc.pid, reason: 'close' })
      host.proc.kill('SIGKILL')
      exits.push(host.proc.exited)
    }
    hosts.length = 0
    await Promise.all(exits)
  }

  return { render, close }
}

function since(startedAt: number): number {
  return (performance.now() - startedAt) / 1000
}
