import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ArtifactSpec, Driver, JobEvent, TaskContext } from '@clouddeck/contracts'
import { createProviderFromEnv, type TtsProvider } from './providers'

export { createFakeProvider, createProviderFromEnv, HttpTtsProvider } from './providers'
export { buildChunks, chunkText, splitChapters, splitSegments } from './split'
export { concatWav, createToneWav, parseWav, wavDurationMs } from './wav'
import { buildChunks, splitChapters, type TtsChunk } from './split'
import { concatWav } from './wav'

export const TTS_DRIVER_ID = 'workers/tts'
export const CHECKPOINT_FILE = 'checkpoint.json'

export interface TtsDriverOptions {
  provider?: TtsProvider
  pricePer1kUsd?: number
  maxCharsPerChunk?: number
  /** 测试用：在第 N 个待合成块上失败（1 起） */
  failAtChunk?: number
}

interface TtsParams {
  defaultVoice?: string
  voiceMap?: string | Record<string, string>
  maxCharsPerChunk?: number
}

const at = () => new Date().toISOString()

async function readCheckpoint(path: string): Promise<Set<string>> {
  try {
    const payload = JSON.parse(await readFile(path, 'utf8')) as { completed?: string[] }
    return new Set(payload.completed ?? [])
  } catch {
    return new Set()
  }
}

async function writeCheckpoint(path: string, completed: Set<string>): Promise<void> {
  const temp = `${path}.tmp`
  await writeFile(temp, JSON.stringify({ completed: [...completed] }, null, 2))
  await rename(temp, path)
}

function parseVoiceMap(value: TtsParams['voiceMap']): Record<string, string> {
  if (!value) return {}
  if (typeof value === 'object') return value
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

function resolveVoice(
  role: string,
  voiceMap: Record<string, string>,
  defaultVoice: string,
): string {
  return voiceMap[role] ?? (role === '对白' ? voiceMap['对白'] : undefined) ?? defaultVoice
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function chunkFilename(chunk: TtsChunk): string {
  return `${chunk.id}.wav`
}

async function listArtifacts(outputDir: string, type: string): Promise<ArtifactSpec[]> {
  const files = (await readdir(outputDir).catch(() => [] as string[])).filter((file) =>
    /^(chapter-\d+|audiobook)\.wav$/.test(file),
  )
  return files
    .sort((a, b) => {
      if (a === 'audiobook.wav') return 1
      if (b === 'audiobook.wav') return -1
      return a.localeCompare(b, 'en', { numeric: true })
    })
    .map((file) => ({
      name: file.replace(/\.wav$/, ''),
      type: type as ArtifactSpec['type'],
      path: join(outputDir, file),
      mime: 'audio/wav',
    }))
}

export function createTtsDriver(options: TtsDriverOptions = {}): Driver {
  const provider = options.provider ?? createProviderFromEnv(process.env)
  const pricePer1kUsd = options.pricePer1kUsd ?? 0.002
  const defaultMaxChars = options.maxCharsPerChunk ?? 200

  return {
    id: TTS_DRIVER_ID,
    protocolVersion: 1,

    async submit() {
      return {}
    },

    async *events(ctx: TaskContext): AsyncGenerator<JobEvent> {
      const params = ctx.params as TtsParams
      const voiceMap = parseVoiceMap(params.voiceMap)
      const defaultVoice = params.defaultVoice?.trim() || 'narrator'
      const maxChars = Math.min(
        Math.max(params.maxCharsPerChunk ?? defaultMaxChars, 50),
        1000,
      )

      const source = ctx.inputs[0]
      if (!source) {
        yield { type: 'error', code: 'NO_INPUT', message: '缺少稿件输入', retryable: false, at: at() }
        return
      }

      const text = await readFile(source.path, 'utf8')
      const chapters = splitChapters(text)
      const chunks = buildChunks(chapters, '旁白', maxChars)
      if (chunks.length === 0) {
        yield { type: 'error', code: 'EMPTY_INPUT', message: '稿件没有可合成内容', retryable: false, at: at() }
        return
      }

      const chunksDir = join(ctx.outputDir, 'chunks')
      await mkdir(chunksDir, { recursive: true })
      const checkpointPath = join(ctx.outputDir, CHECKPOINT_FILE)
      const checkpoint = await readCheckpoint(checkpointPath)

      // 校验 checkpoint 对应文件仍存在，避免工作区被清理后误跳过
      for (const id of [...checkpoint]) {
        if (!(await fileExists(join(chunksDir, `${id}.wav`)))) checkpoint.delete(id)
      }

      const outputType = ctx.capability.outputs?.[0]?.assetType ?? 'audio_track'
      let processed = checkpoint.size
      let attempt = 0

      for (const chunk of chunks) {
        if (ctx.signal.aborted) {
          yield { type: 'error', code: 'CANCELLED', message: '任务已取消', retryable: false, at: at() }
          return
        }

        if (checkpoint.has(chunk.id)) {
          yield {
            type: 'log',
            level: 'debug',
            message: `跳过已完成块 ${chunk.id}`,
            at: at(),
          }
          continue
        }

        attempt += 1
        if (options.failAtChunk !== undefined && attempt === options.failAtChunk) {
          yield {
            type: 'error',
            code: 'TTS_FAILED',
            message: `注入失败：第 ${attempt} 个待合成块`,
            retryable: true,
            at: at(),
          }
          return
        }

        const voice = resolveVoice(chunk.role, voiceMap, defaultVoice)
        try {
          const audio = await provider.synthesize({ text: chunk.text, voice, format: 'wav' })
          await writeFile(join(chunksDir, chunkFilename(chunk)), audio)
        } catch (error) {
          yield {
            type: 'error',
            code: 'TTS_FAILED',
            message: error instanceof Error ? error.message : '语音合成失败',
            retryable: true,
            at: at(),
          }
          return
        }

        checkpoint.add(chunk.id)
        await writeCheckpoint(checkpointPath, checkpoint)
        processed += 1

        const cost = Number(((chunk.text.length / 1000) * pricePer1kUsd).toFixed(6))
        yield { type: 'usage', chars: chunk.text.length, costUsd: cost, at: at() }
        yield {
          type: 'progress',
          percent: Math.round((processed / chunks.length) * 95),
          message: `${processed}/${chunks.length} 块`,
          at: at(),
        }
      }

      // 按章节拼接
      const chaptersWithChunks = new Map<number, string[]>()
      for (const chunk of chunks) {
        const list = chaptersWithChunks.get(chunk.chapter) ?? []
        list.push(join(chunksDir, chunkFilename(chunk)))
        chaptersWithChunks.set(chunk.chapter, list)
      }

      const chapterBuffers: Buffer[] = []
      for (const [chapterIndex, files] of [...chaptersWithChunks.entries()].sort(
        (a, b) => a[0] - b[0],
      )) {
        const buffers = await Promise.all(files.map((file) => readFile(file)))
        const merged = concatWav(buffers)
        await writeFile(join(ctx.outputDir, `chapter-${chapterIndex + 1}.wav`), merged)
        chapterBuffers.push(merged)
      }

      if (chapterBuffers.length > 0) {
        const audiobook = concatWav(chapterBuffers)
        await writeFile(join(ctx.outputDir, 'audiobook.wav'), audiobook)
      }

      const artifacts = await listArtifacts(ctx.outputDir, outputType)
      for (const artifact of artifacts) {
        yield { type: 'artifact', spec: artifact, at: at() }
      }

      yield { type: 'progress', percent: 100, message: '合成完成', at: at() }
      yield { type: 'done', at: at() }
    },

    async cancel() {
      // 取消通过 ctx.signal 传播，逐块检查
    },

    async collect(ctx: TaskContext): Promise<ArtifactSpec[]> {
      const type = ctx.capability.outputs?.[0]?.assetType ?? 'audio_track'
      return listArtifacts(ctx.outputDir, type)
    },
  }
}
