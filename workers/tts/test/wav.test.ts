import { describe, expect, it } from 'vitest'
import { concatWav, createToneWav, parseWav, wavDurationMs } from '../src/wav'

describe('WAV 工具', () => {
  it('生成可解析的 PCM WAV', () => {
    const wav = createToneWav(100)
    const info = parseWav(wav)
    expect(info.sampleRate).toBe(16000)
    expect(info.channels).toBe(1)
    expect(info.bitsPerSample).toBe(16)
    expect(wavDurationMs(wav)).toBeCloseTo(100, 0)
  })

  it('拼接后时长相加', () => {
    const first = createToneWav(100)
    const second = createToneWav(200)
    const merged = concatWav([first, second])
    expect(wavDurationMs(merged)).toBeCloseTo(300, 0)
  })

  it('拒绝格式不一致的拼接', () => {
    const first = createToneWav(100, 16000)
    const second = createToneWav(100, 8000)
    expect(() => concatWav([first, second])).toThrow('格式不一致')
  })
})
