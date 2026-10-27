import { describe, expect, test } from 'bun:test'
import { mountedApp } from './mounted-app'
import { readCatalog, readRoutes } from './route-records'

type Operation = {
  operationId?: string
  summary?: string
  description?: string
  tags?: string[]
  'x-endpoint-id'?: string
  'x-audience'?: { kind: string }
}

type Schema = {
  description?: string
  properties?: Record<string, Schema>
  items?: Schema
  anyOf?: Schema[]
}
type RequestOperation = {
  parameters?: { name: string; in: string; description?: string; schema: Schema }[]
  requestBody?: { content: Record<string, { schema: Schema }> }
}

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

  test('AG-02a every numbered operation has a summary and a description, and its tags are described', async () => {
    const res = await mountedApp().handle(new Request('http://localhost/api/v1/openapi.json'))
    const doc = (await res.json()) as {
      paths: Record<string, Record<string, Operation>>
      tags?: { name: string; description?: string }[]
    }
    const operations = Object.values(doc.paths)
      .flatMap((methods) => Object.values(methods))
      .filter((op) => op['x-endpoint-id'] !== undefined)
    expect(operations.filter((op) => !op.summary?.trim())).toEqual([])
    expect(operations.filter((op) => !op.description?.trim())).toEqual([])
    const described = new Set(doc.tags?.filter((tag) => tag.description).map((tag) => tag.name))
    const used = new Set(operations.flatMap((op) => op.tags ?? []))
    expect([...used].filter((tag) => !described.has(tag))).toEqual([])
  })

  test('AG-02b every enum of the OpenAPI document explains each of its values', async () => {
    const res = await mountedApp().handle(new Request('http://localhost/api/v1/openapi.json'))
    const doc = (await res.json()) as { paths: unknown }
    const unexplained: string[] = []
    const walk = (node: unknown, where: string) => {
      if (Array.isArray(node)) {
        node.forEach((item, i) => {
          walk(item, `${where}[${i}]`)
        })
        return
      }
      if (typeof node !== 'object' || node === null) return
      const schema = node as { enum?: string[]; 'x-enumDescriptions'?: Record<string, string> }
      if (schema.enum) {
        const explained = Object.keys(schema['x-enumDescriptions'] ?? {})
        if ([...schema.enum].sort().join() !== explained.sort().join()) unexplained.push(where)
      }
      for (const [key, child] of Object.entries(node)) walk(child, `${where}.${key}`)
    }
    walk(doc.paths, 'paths')
    expect(unexplained).toEqual([])
  })

  test('AG-02c every parameter and every field of a request body has a description', async () => {
    const res = await mountedApp().handle(new Request('http://localhost/api/v1/openapi.json'))
    const doc = (await res.json()) as { paths: Record<string, Record<string, RequestOperation>> }
    const undescribed: string[] = []
    const walk = (schema: Schema | undefined, where: string) => {
      if (!schema) return
      for (const [key, field] of Object.entries(schema.properties ?? {})) {
        if (!field.description) undescribed.push(`${where}.${key}`)
        walk(field, `${where}.${key}`)
      }
      if (schema.items) walk(schema.items, `${where}[]`)
      for (const branch of schema.anyOf ?? []) walk(branch, where)
    }
    for (const [path, methods] of Object.entries(doc.paths))
      for (const [method, op] of Object.entries(methods)) {
        const here = `${method.toUpperCase()} ${path}`
        for (const param of op.parameters ?? [])
          if (!param.description && !param.schema.description)
            undescribed.push(`${here} ${param.in}:${param.name}`)
        walk(op.requestBody?.content['application/json']?.schema, `${here} body`)
      }
    expect(undescribed).toEqual([])
  })
})
