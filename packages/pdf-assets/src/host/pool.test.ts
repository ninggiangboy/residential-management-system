import { describe, expect, test } from 'bun:test'
import { Buffer } from 'node:buffer'
import { join } from 'node:path'
import { PdfRenderError } from './errors'
import { createRenderHostPool } from './pool'

const TEMPLATES = join(import.meta.dir, 'fixture-templates.tsx')

/** The `%PDF-` marker that opens every rendered PDF. */
function header(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes.subarray(0, 5))
}

/** Runs a request to its rejection and reports its {@link PdfRenderError} code. */
async function rejectionCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise
    return undefined
  } catch (error) {
    return error instanceof PdfRenderError ? error.code : undefined
  }
}

describe('render host pool (DOC-34 §4, DR-291)', () => {
  test('renders the hello fixture as a Uint8Array PDF', async () => {
    const pool = createRenderHostPool({ templatesModule: TEMPLATES, size: 1 })
    try {
      const bytes = await pool.render('hello', null)
      expect(bytes).toBeInstanceOf(Uint8Array)
      expect(header(bytes)).toBe('%PDF-')
    } finally {
      await pool.close()
    }
  }, 30_000)

  test('renders two bundled kinds', async () => {
    const pool = createRenderHostPool({ templatesModule: TEMPLATES, size: 1 })
    try {
      expect(header(await pool.render('hello', null))).toBe('%PDF-')
      expect(header(await pool.render('two', null))).toBe('%PDF-')
    } finally {
      await pool.close()
    }
  }, 30_000)

  test('recycles the host after maxDocuments and starts a new one', async () => {
    const starts: number[] = []
    const restarts: string[] = []
    const pool = createRenderHostPool({
      templatesModule: TEMPLATES,
      size: 1,
      maxDocuments: 2,
      onLog: (event, fields) => {
        if (event === 'pdf.host_start') starts.push(fields.pid as number)
      },
      observer: {
        rendered: () => {},
        restarted: (reason) => restarts.push(reason),
      },
    })
    try {
      await pool.render('hello', null)
      await pool.render('hello', null)
      expect(restarts).toEqual(['documents'])
      expect(header(await pool.render('hello', null))).toBe('%PDF-')
      expect(starts).toHaveLength(2)
      expect(starts[1]).not.toBe(starts[0])
    } finally {
      await pool.close()
    }
  }, 30_000)

  test('kills a host that passes renderTimeoutMs and replaces it', async () => {
    const restarts: string[] = []
    const pool = createRenderHostPool({
      templatesModule: TEMPLATES,
      size: 1,
      renderTimeoutMs: 250,
      observer: {
        rendered: () => {},
        restarted: (reason) => restarts.push(reason),
      },
    })
    try {
      expect(await rejectionCode(pool.render('slow', 2_000))).toBe('timeout')
      expect(restarts).toEqual(['timeout'])
      expect(header(await pool.render('hello', null))).toBe('%PDF-')
    } finally {
      await pool.close()
    }
  }, 30_000)

  test('fails a pending render when the host exits and then replaces it', async () => {
    const restarts: string[] = []
    const pool = createRenderHostPool({
      templatesModule: TEMPLATES,
      size: 1,
      observer: {
        rendered: () => {},
        restarted: (reason) => restarts.push(reason),
      },
    })
    try {
      expect(await rejectionCode(pool.render('crash', null))).toBe('host_exited')
      expect(restarts).toEqual(['crash'])
      expect(header(await pool.render('hello', null))).toBe('%PDF-')
    } finally {
      await pool.close()
    }
  }, 30_000)

  test('serves three parallel renders on one host in FIFO order', async () => {
    const pool = createRenderHostPool({ templatesModule: TEMPLATES, size: 1 })
    const order: number[] = []
    try {
      const renders = [0, 1, 2].map((index) =>
        pool.render('hello', null).then((bytes) => {
          order.push(index)
          return bytes
        }),
      )
      const sizes = await Promise.all(renders)
      expect(sizes.every((bytes) => header(bytes) === '%PDF-')).toBe(true)
      expect(order).toEqual([0, 1, 2])
    } finally {
      await pool.close()
    }
  }, 30_000)

  test('rejects a queued request with busy when the only host is slow', async () => {
    const pool = createRenderHostPool({
      templatesModule: TEMPLATES,
      size: 1,
      renderTimeoutMs: 10_000,
      waitTimeoutMs: 200,
    })
    try {
      const slow = pool.render('slow', 1_500)
      expect(await rejectionCode(pool.render('hello', null))).toBe('busy')
      expect(header(await slow)).toBe('%PDF-')
    } finally {
      await pool.close()
    }
  }, 30_000)

  test('exits an idle host', async () => {
    const restarts: string[] = []
    const pool = createRenderHostPool({
      templatesModule: TEMPLATES,
      size: 1,
      idleExitMs: 150,
      observer: {
        rendered: () => {},
        restarted: (reason) => restarts.push(reason),
      },
    })
    try {
      await pool.render('hello', null)
      await Bun.sleep(500)
      expect(restarts).toEqual(['idle'])
    } finally {
      await pool.close()
    }
  }, 30_000)

  test('renders the same input to identical bytes (PD-29)', async () => {
    const pool = createRenderHostPool({ templatesModule: TEMPLATES, size: 1 })
    try {
      const first = await pool.render('hello', null)
      const second = await pool.render('hello', null)
      expect(Buffer.compare(Buffer.from(first), Buffer.from(second))).toBe(0)
    } finally {
      await pool.close()
    }
  }, 30_000)
})
