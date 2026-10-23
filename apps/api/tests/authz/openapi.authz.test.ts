import { describe, expect, test } from 'bun:test'
import { mountedApp } from './mounted-app'
import { readCatalog, readRoutes } from './route-records'

type Operation = { operationId?: string; 'x-endpoint-id'?: string; 'x-audience'?: { kind: string } }

describe('the OpenAPI document carries the route metadata', () => {
  test('AG-02 the x-endpoint-id values equal the implemented E-xx of DOC-51 §2: no extra, no duplicate', async () => {
    const app = mountedApp()
    const res = await app.handle(new Request('http://localhost/api/v1/openapi.json'))
    expect(res.status).toBe(200)
    const doc = (await res.json()) as { paths: Record<string, Record<string, Operation>> }
    const operations = Object.values(doc.paths).flatMap((methods) => Object.values(methods))
    const ids = operations
      .map((op) => op['x-endpoint-id'])
      .filter((id): id is string => id !== undefined)
    expect(new Set(ids).size).toBe(ids.length)
    expect(
      operations.filter((op) => op['x-endpoint-id'] === undefined && op.operationId !== undefined),
    ).toEqual([])
    const mounted = readRoutes(app).records.map((r) => r.endpointId)
    expect([...ids].sort()).toEqual([...mounted].sort())
    const catalogued = new Set(readCatalog().map((e) => e.endpointId))
    expect(ids.filter((id) => !catalogued.has(id))).toEqual([])
    for (const op of operations)
      if (op['x-endpoint-id']) expect(op['x-audience']?.kind).toBeDefined()
  })
})
