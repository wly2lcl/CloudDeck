import { describe, expect, it } from 'vitest'
import { parseSrt, serializeSrt } from '../src/srt'

describe('SRT 解析', () => {
  it('往返解析与序列化', () => {
    const source = '1\n00:00:00,000 --> 00:00:01,500\n第一句\n\n2\n00:00:02,000 --> 00:00:03,000\n第二句\n'
    const cues = parseSrt(source)
    expect(cues).toHaveLength(2)
    expect(cues[1]?.startMs).toBe(2000)
    expect(serializeSrt(cues)).toContain('00:00:02,000 --> 00:00:03,000')
  })

  it('拒绝非法时间戳', () => {
    expect(() => parseSrt('1\nbad --> 00:00:01,000\ntext')).toThrow()
  })
})
