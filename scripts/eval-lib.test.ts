import { describe, expect, it } from 'vitest'
import { evaluateOutput } from './eval-lib'

describe('LLM 评测检查', () => {
  it('接受符合长度与关键词的输出', () => {
    const result = evaluateOutput('林晚走向灯塔。'.repeat(80), {
      minChars: 100,
      maxChars: 2000,
      mustInclude: ['林晚', '灯塔'],
      maxClicheCount: 1,
    })
    expect(result.passed).toBe(true)
  })

  it('拒绝非法 JSON 与套话', () => {
    const invalid = evaluateOutput('not json', { json: true })
    expect(invalid.score).toBe(0)
    const cliche = evaluateOutput('她仿佛不禁嘴角微微上扬。'.repeat(100), {
      minChars: 10,
      maxClicheCount: 0,
    })
    expect(cliche.passed).toBe(false)
    expect(cliche.metrics.clicheCount).toBeGreaterThan(0)
  })
})
