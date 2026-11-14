import { describe, expect, it } from 'vitest'
import { canTransition, isTerminal, jobEventSchema } from '../src/index'

describe('Job 状态机', () => {
  it('允许合法流转', () => {
    expect(canTransition('queued', 'provisioning')).toBe(true)
    expect(canTransition('provisioning', 'running')).toBe(true)
    expect(canTransition('running', 'finalizing')).toBe(true)
    expect(canTransition('finalizing', 'succeeded')).toBe(true)
    expect(canTransition('running', 'cancelled')).toBe(true)
  })

  it('拒绝非法流转', () => {
    expect(canTransition('queued', 'running')).toBe(false)
    expect(canTransition('succeeded', 'running')).toBe(false)
    expect(canTransition('cancelled', 'failed')).toBe(false)
  })

  it('终态不可再流转', () => {
    for (const status of ['succeeded', 'failed', 'cancelled'] as const) {
      expect(isTerminal(status)).toBe(true)
    }
    expect(isTerminal('running')).toBe(false)
  })
})

describe('JobEvent 校验', () => {
  it('接受合法进度事件', () => {
    const result = jobEventSchema.safeParse({
      type: 'progress',
      percent: 37,
      at: '2026-11-14T09:12:03Z',
    })
    expect(result.success).toBe(true)
  })

  it('拒绝越界百分比', () => {
    const result = jobEventSchema.safeParse({
      type: 'progress',
      percent: 120,
      at: '2026-11-14T09:12:03Z',
    })
    expect(result.success).toBe(false)
  })

  it('拒绝未知事件类型', () => {
    const result = jobEventSchema.safeParse({ type: 'unknown', at: '2026-11-14T09:12:03Z' })
    expect(result.success).toBe(false)
  })
})
