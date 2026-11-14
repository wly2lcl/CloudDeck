import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ArtifactSpec, Driver, JobEvent, TaskContext } from '@clouddeck/contracts'
import { createShotFrame } from './bmp'
import { buildTimeline, parseStoryboard, toSrt, totalDurationMs } from './timeline'

export const VIDEO_DRIVER_ID = 'workers/video'

export interface VideoDriverOptions {
  ffmpeg?: string
  width?: number
  height?: number
  fps?: number
}

const at = () => new Date().toISOString()
const tail = (value: string, max = 400) =>
  value.length > max ? `…${value.slice(-max)}` : value

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export function createVideoDriver(options: VideoDriverOptions = {}): Driver {
  const ffmpeg = options.ffmpeg ?? process.env.FFMPEG_BIN ?? 'ffmpeg'
  const width = options.width ?? 640
  const height = options.height ?? 360
  const fps = options.fps ?? 25

  return {
    id: VIDEO_DRIVER_ID,
    protocolVersion: 1,

    async submit() {
      return {}
    },

    async *events(ctx: TaskContext): AsyncGenerator<JobEvent> {
      const storyboardInput = ctx.inputs[0]
      const audioInput = ctx.inputs[1]
      if (!storyboardInput) {
        yield { type: 'error', code: 'NO_INPUT', message: '缺少分镜输入', retryable: false, at: at() }
        return
      }

      let storyboard
      try {
        storyboard = parseStoryboard(await readFile(storyboardInput.path, 'utf8'))
      } catch (error) {
        yield {
          type: 'error',
          code: 'INVALID_STORYBOARD',
          message: error instanceof Error ? error.message : '分镜格式非法',
          retryable: false,
          at: at(),
        }
        return
      }

      const timeline = buildTimeline(storyboard.shots)
      const framesDir = join(ctx.outputDir, 'frames')
      await mkdir(framesDir, { recursive: true })

      for (const item of timeline) {
        if (ctx.signal.aborted) {
          yield { type: 'error', code: 'CANCELLED', message: '任务已取消', retryable: false, at: at() }
          return
        }
        const frame = createShotFrame(item.index - 1, width, height)
        await writeFile(join(framesDir, `frame-${String(item.index).padStart(3, '0')}.bmp`), frame)
        yield {
          type: 'progress',
          percent: Math.round((item.index / timeline.length) * 20),
          message: `生成画面 ${item.index}/${timeline.length}`,
          at: at(),
        }
      }

      await writeFile(join(ctx.outputDir, 'subtitles.srt'), toSrt(timeline))

      const clips: string[] = []
      for (const item of timeline) {
        if (ctx.signal.aborted) {
          yield { type: 'error', code: 'CANCELLED', message: '任务已取消', retryable: false, at: at() }
          return
        }
        const frame = join(framesDir, `frame-${String(item.index).padStart(3, '0')}.bmp`)
        const clip = `shot-${String(item.index).padStart(3, '0')}.mp4`
        const seconds = (item.durationMs / 1000).toFixed(3)
        const result = await ctx.commands.run(
          ffmpeg,
          [
            '-y',
            '-loop',
            '1',
            '-i',
            frame,
            '-t',
            seconds,
            '-vf',
            `zoompan=z='min(zoom+0.0015,1.12)':d=${Math.max(1, Math.round(fps * (item.durationMs / 1000)))}:s=${width}x${height}:fps=${fps}`,
            '-pix_fmt',
            'yuv420p',
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            clip,
          ],
          { cwd: ctx.outputDir, signal: ctx.signal, timeoutMs: 120_000 },
        )
        if (result.exitCode !== 0) {
          yield {
            type: 'error',
            code: result.stderr.includes('ENOENT') ? 'FFMPEG_UNAVAILABLE' : 'FFMPEG_FAILED',
            message: tail(result.stderr),
            retryable: true,
            at: at(),
          }
          return
        }
        clips.push(clip)
        yield {
          type: 'progress',
          percent: 20 + Math.round((item.index / timeline.length) * 60),
          message: `渲染镜头 ${item.index}/${timeline.length}`,
          at: at(),
        }
      }

      await writeFile(
        join(ctx.outputDir, 'clips.txt'),
        clips.map((clip) => `file '${clip}'`).join('\n'),
      )

      const concat = await ctx.commands.run(
        ffmpeg,
        ['-y', '-f', 'concat', '-safe', '0', '-i', 'clips.txt', '-c', 'copy', 'silent.mp4'],
        { cwd: ctx.outputDir, signal: ctx.signal, timeoutMs: 120_000 },
      )
      if (concat.exitCode !== 0) {
        yield { type: 'error', code: 'FFMPEG_FAILED', message: tail(concat.stderr), retryable: true, at: at() }
        return
      }

      if (audioInput) {
        const mux = await ctx.commands.run(
          ffmpeg,
          [
            '-y',
            '-i',
            'silent.mp4',
            '-i',
            audioInput.path,
            '-c:v',
            'copy',
            '-c:a',
            'aac',
            '-shortest',
            '-movflags',
            '+faststart',
            'video.mp4',
          ],
          { cwd: ctx.outputDir, signal: ctx.signal, timeoutMs: 300_000 },
        )
        if (mux.exitCode !== 0) {
          yield { type: 'error', code: 'FFMPEG_FAILED', message: tail(mux.stderr), retryable: true, at: at() }
          return
        }
      } else {
        await rename(join(ctx.outputDir, 'silent.mp4'), join(ctx.outputDir, 'video.mp4'))
      }

      const duration = totalDurationMs(timeline)
      const outputType = ctx.capability.outputs?.[0]?.assetType ?? 'video'
      yield {
        type: 'artifact',
        spec: {
          name: 'video',
          type: outputType,
          path: join(ctx.outputDir, 'video.mp4'),
          mime: 'video/mp4',
          meta: { durationMs: duration, shots: timeline.length },
        },
        at: at(),
      }
      yield {
        type: 'artifact',
        spec: {
          name: 'subtitles',
          type: 'document',
          path: join(ctx.outputDir, 'subtitles.srt'),
          mime: 'application/x-subrip',
        },
        at: at(),
      }
      yield {
        type: 'artifact',
        spec: {
          name: 'frame-001',
          type: 'image',
          path: join(framesDir, 'frame-001.bmp'),
          mime: 'image/bmp',
        },
        at: at(),
      }

      yield { type: 'progress', percent: 100, message: '视频合成完成', at: at() }
      yield { type: 'done', at: at() }
    },

    async cancel() {
      // 取消通过 ctx.signal 传递给 ffmpeg 进程
    },

    async collect(ctx: TaskContext): Promise<ArtifactSpec[]> {
      const outputType = ctx.capability.outputs?.[0]?.assetType ?? 'video'
      const specs: ArtifactSpec[] = [
        {
          name: 'video',
          type: outputType,
          path: join(ctx.outputDir, 'video.mp4'),
          mime: 'video/mp4',
        },
        {
          name: 'subtitles',
          type: 'document',
          path: join(ctx.outputDir, 'subtitles.srt'),
          mime: 'application/x-subrip',
        },
        {
          name: 'frame-001',
          type: 'image',
          path: join(ctx.outputDir, 'frames', 'frame-001.bmp'),
          mime: 'image/bmp',
        },
      ]
      const result: ArtifactSpec[] = []
      for (const spec of specs) {
        if (await exists(spec.path)) result.push(spec)
      }
      return result
    },
  }
}
