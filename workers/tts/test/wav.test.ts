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

describe('响度归一', () => {
  it('把低音量 WAV 峰值提升到目标值', async () => {
    const { createToneWav, normalizeWav, parseWav } = await import('../src/wav')
    const normalized = normalizeWav(createToneWav(120), 0.9)
    const info = parseWav(normalized)
    let peak = 0
    for (let offset = 0; offset + 1 < info.data.length; offset += 2) {
      peak = Math.max(peak, Math.abs(info.data.readInt16LE(offset)))
    }
    expect(peak).toBeGreaterThan(0.88 * 32767)
    expect(peak).toBeLessThanOrEqual(0.91 * 32767)
  })
})

describe('流式 WAV 拼接', () => {
  it('按文件顺序拼接且时长相加', async () => {
    const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { createToneWav, concatWavFiles, parseWav, wavDurationMs } = await import('../src/wav')
    const dir = await mkdtemp(join(tmpdir(), 'clouddeck-wav-'))
    const first = join(dir, 'a.wav')
    const second = join(dir, 'b.wav')
    await writeFile(first, createToneWav(300))
    await writeFile(second, createToneWav(500))
    const output = join(dir, 'out.wav')
    await concatWavFiles([first, second], output)
    const duration = wavDurationMs(await readFile(output))
    expect(duration).toBeGreaterThan(780)
    expect(parseWav(await readFile(output)).channels).toBe(1)
    await rm(dir, { recursive: true, force: true })
  })
})
