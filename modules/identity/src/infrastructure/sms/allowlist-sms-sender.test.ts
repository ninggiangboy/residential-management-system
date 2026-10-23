import { describe, expect, test } from 'bun:test'
import type { SmsSender } from '../../application/ports'
import { AllowlistSmsSender } from './allowlist-sms-sender'

const message = (to: string) => ({ to, text: 'x', requestId: 'r1' })

describe('AllowlistSmsSender (DOC-26 §5.5)', () => {
  test('a listed number is sent, any other is logged not_allowlisted and returns normally', async () => {
    const sent: string[] = []
    const logged: unknown[] = []
    const inner: SmsSender = { send: async (m) => void sent.push(m.to) }
    const sender = new AllowlistSmsSender(inner, ['+84901234567'], {
      info() {},
      warn: (fields) => void logged.push(fields),
      error() {},
    })
    await sender.send(message('+84901234567'))
    await sender.send(message('+84909999999'))
    expect(sent).toEqual(['+84901234567'])
    expect(logged).toEqual([expect.objectContaining({ outcome: 'not_allowlisted' })])
  })
})
