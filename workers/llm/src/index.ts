import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ArtifactSpec, Driver, JobEvent, TaskContext } from '@clouddeck/contracts'
import { createLlmProviderFromEnv, type LlmProvider } from './providers'

export { createLlmProviderFromEnv, HttpLlmProvider } from './providers'
export { GatewayProvider } from './gateway'

export const LLM_DRIVER_ID = 'workers/llm'

const at = () => new Date().toISOString()
const CHAPTER_RE = /^\s*(第[零一二三四五六七八九十百千万两0-9]+[章节回卷][^\n]*)\s*$/
const SCENE_RE = /^###\s*第\s*\d+\s*场\s*(.+)$/
const DIALOGUE_RE = /([一-龥A-Za-z0-9]{1,8})[：:]\s*[“「"]([^”」"]+)[”」"]/

interface Scene {
  title: string
  body: string
}

interface Dialogue {
  role: string
  line: string
}

interface Shot {
  index: number
  scene: string
  description: string
  shotSize: string
  camera: string
  durationMs: number
}

export interface ScriptStructure {
  title: string
  acts: { title: string; scenes: { title: string; summary: string; characters: string[]; dialogues: Dialogue[] }[] }[]
}

export interface StoryboardStructure {
  title: string
  shots: Shot[]
}

function splitScenes(text: string): Scene[] {
  const lines = text.split(/\r?\n/)
  const scenes: Scene[] = []
  let current: Scene | null = null

  for (const line of lines) {
    const matched = CHAPTER_RE.exec(line) ?? /^#{1,2}\s+(.+)$/.exec(line)
    if (matched?.[1]) {
      if (current) scenes.push(current)
      current = { title: matched[1].trim(), body: '' }
      continue
    }
    if (current) current.body += `${line}\n`
  }
  if (current) scenes.push(current)

  if (scenes.length === 0) {
    return [{ title: '全文', body: text }]
  }
  return scenes.map((scene) => ({ ...scene, body: scene.body.trim() }))
}

function dialoguesOf(body: string): Dialogue[] {
  return body
    .split(/\n+/)
    .map((line) => DIALOGUE_RE.exec(line))
    .filter((matched): matched is RegExpExecArray => matched !== null)
    .map((matched) => ({ role: matched[1] as string, line: matched[2] as string }))
}

export function buildScriptHeuristic(text: string, title = '未命名剧本'): ScriptStructure {
  const scenes = splitScenes(text)
  const actsCount = Math.min(3, Math.max(1, Math.ceil(scenes.length / 4)))
  const perAct = Math.ceil(scenes.length / actsCount)
  const acts: ScriptStructure['acts'] = []

  for (let actIndex = 0; actIndex < actsCount; actIndex += 1) {
    const slice = scenes.slice(actIndex * perAct, (actIndex + 1) * perAct)
    if (slice.length === 0) continue
    acts.push({
      title: `第${['一', '二', '三'][actIndex] ?? actIndex + 1}幕`,
      scenes: slice.map((scene) => {
        const dialogues = dialoguesOf(scene.body)
        const characters = [...new Set(dialogues.map((dialogue) => dialogue.role))]
        return {
          title: scene.title,
          summary: scene.body.split(/[。！？]/)[0]?.trim() || scene.title,
          characters,
          dialogues,
        }
      }),
    })
  }

  return { title, acts }
}

export function renderScriptMarkdown(script: ScriptStructure): string {
  const lines: string[] = [`# ${script.title}`, '', '> 由 CloudDeck 生成，供分镜与有声环节消费。', '']
  for (const act of script.acts) {
    lines.push(`## ${act.title}`, '')
    act.scenes.forEach((scene, index) => {
      lines.push(`### 第 ${index + 1} 场 ${scene.title}`, '')
      lines.push(`场景：${scene.summary}`)
      if (scene.characters.length > 0) lines.push(`角色：${scene.characters.join('、')}`)
      lines.push('')
      if (scene.dialogues.length > 0) {
        for (const dialogue of scene.dialogues) {
          lines.push(`- ${dialogue.role}：“${dialogue.line}”`)
        }
      } else {
        lines.push('- 旁白：场景推进，保持原有叙事节奏。')
      }
      lines.push('')
    })
  }
  return lines.join('\n')
}

export function buildStoryboardHeuristic(
  script: string,
  options: { title?: string; shotsPerScene?: number } = {},
): StoryboardStructure {
  const lines = script.split(/\r?\n/)
  const scenes: Scene[] = []
  let current: Scene | null = null
  let title = options.title ?? '未命名剧本'

  for (const line of lines) {
    const topTitle = /^#\s+(.+)$/.exec(line)
    if (topTitle?.[1]) {
      title = topTitle[1].trim()
      continue
    }
    const matched = SCENE_RE.exec(line)
    if (matched?.[1]) {
      if (current) scenes.push(current)
      current = { title: matched[1].trim(), body: '' }
      continue
    }
    if (current) current.body += `${line}\n`
  }
  if (current) scenes.push(current)

  const shotsPerScene = Math.min(Math.max(options.shotsPerScene ?? 2, 1), 5)
  const shots: Shot[] = []
  const sizes = ['全景', '中景', '近景', '特写']
  const cameras = ['固定', '缓推', '横移', '手持']

  scenes.forEach((scene, sceneIndex) => {
    const dialogues = dialoguesOf(scene.body)
    for (let index = 0; index < shotsPerScene; index += 1) {
      const dialogue = dialogues[index]
      shots.push({
        index: shots.length + 1,
        scene: scene.title,
        description: dialogue
          ? `${dialogue.role}：“${dialogue.line}”`
          : `${scene.title}：${scene.body.split(/[。！？]/)[0]?.trim() || '场景建立'}`,
        shotSize: sizes[index % sizes.length] as string,
        camera: cameras[(sceneIndex + index) % cameras.length] as string,
        durationMs: 2500 + index * 500,
      })
    }
  })

  return { title, shots }
}

function scriptPrompt(text: string): string {
  return [
    '把下面的小说文本改编为中文剧本，输出 JSON。',
    'JSON 结构：{"title":string,"acts":[{"title":string,"scenes":[{"title":string,"summary":string,"characters":string[],"dialogues":[{"role":string,"line":string}]}]}]}',
    '要求：保留原作主要情节与人物，分幕合理，对白简洁。',
    '',
    '小说文本：',
    text.slice(0, 20000),
  ].join('\n')
}

function storyboardPrompt(script: string, shotsPerScene: number): string {
  return [
    '把下面的剧本拆成分镜，输出 JSON。',
    'JSON 结构：{"title":string,"shots":[{"index":number,"scene":string,"description":string,"shotSize":string,"camera":string,"durationMs":number}]}',
    `每个场景至少 ${shotsPerScene} 个镜头，描述要具体到画面与动作。`,
    '',
    '剧本：',
    script.slice(0, 20000),
  ].join('\n')
}

function parseJson<T>(text: string): T {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '')
  return JSON.parse(cleaned) as T
}

export interface LlmDriverOptions {
  provider?: LlmProvider
  model?: string
}

export function createLlmDriver(options: LlmDriverOptions = {}): Driver {
  return {
    id: LLM_DRIVER_ID,
    protocolVersion: 1,

    async submit() {
      return {}
    },

    async *events(ctx: TaskContext): AsyncGenerator<JobEvent> {
      const provider =
        options.provider ??
        createLlmProviderFromEnv({ ...process.env, ...ctx.env } as NodeJS.ProcessEnv)
      const source = ctx.inputs[0]
      if (!source) {
        yield { type: 'error', code: 'NO_INPUT', message: '缺少输入文件', retryable: false, at: at() }
        return
      }

      const text = await readFile(source.path, 'utf8')
      const outputType = ctx.capability.outputs?.[0]?.assetType ?? 'document'
      const params = ctx.params as { style?: string; shotsPerScene?: number; title?: string }
      await mkdir(ctx.outputDir, { recursive: true })

      try {
        if (ctx.capability.id === 'script.generate') {
          let script: ScriptStructure
          if (provider) {
            const result = await provider.complete({
              system: '你是专业中文编剧，只输出 JSON。',
              prompt: scriptPrompt(text),
              json: true,
            })
            if (result.costUsd > 0) {
              yield {
                type: 'usage',
                inputTokens: result.inputTokens,
                outputTokens: result.outputTokens,
                costUsd: result.costUsd,
                at: at(),
              }
            }
            script = parseJson<ScriptStructure>(result.text)
          } else {
            script = buildScriptHeuristic(text, params.title ?? '未命名剧本')
          }

          const markdown = renderScriptMarkdown(script)
          await writeFile(join(ctx.outputDir, 'script.md'), markdown)
          yield { type: 'log', level: 'info', message: `剧本完成：${script.acts.length} 幕`, at: at() }
        } else if (ctx.capability.id === 'storyboard.plan') {
          let storyboard: StoryboardStructure
          if (provider) {
            const result = await provider.complete({
              system: '你是专业分镜师，只输出 JSON。',
              prompt: storyboardPrompt(text, params.shotsPerScene ?? 2),
              json: true,
            })
            if (result.costUsd > 0) {
              yield {
                type: 'usage',
                inputTokens: result.inputTokens,
                outputTokens: result.outputTokens,
                costUsd: result.costUsd,
                at: at(),
              }
            }
            storyboard = parseJson<StoryboardStructure>(result.text)
          } else {
            storyboard = buildStoryboardHeuristic(text, { shotsPerScene: params.shotsPerScene })
          }

          await writeFile(
            join(ctx.outputDir, 'storyboard.json'),
            JSON.stringify(storyboard, null, 2),
          )
          yield {
            type: 'log',
            level: 'info',
            message: `分镜完成：${storyboard.shots.length} 个镜头`,
            at: at(),
          }
        } else {
          yield {
            type: 'error',
            code: 'UNSUPPORTED_CAPABILITY',
            message: `worker-llm 不支持 ${ctx.capability.id}`,
            retryable: false,
            at: at(),
          }
          return
        }
      } catch (error) {
        yield {
          type: 'error',
          code: 'LLM_FAILED',
          message: error instanceof Error ? error.message : '生成失败',
          retryable: true,
          at: at(),
        }
        return
      }

      const file =
        ctx.capability.id === 'script.generate' ? 'script.md' : 'storyboard.json'
      const mime = file.endsWith('.json') ? 'application/json' : 'text/markdown'

      yield {
        type: 'artifact',
        spec: { name: file.replace(/\.(md|json)$/, ''), type: outputType, path: join(ctx.outputDir, file), mime },
        at: at(),
      }
      yield { type: 'progress', percent: 100, message: '生成完成', at: at() }
      yield { type: 'done', at: at() }
    },

    async cancel() {
      // 单次生成，无需额外清理
    },

    async collect(ctx: TaskContext): Promise<ArtifactSpec[]> {
      const outputType = ctx.capability.outputs?.[0]?.assetType ?? 'document'
      const file = ctx.capability.id === 'script.generate' ? 'script.md' : 'storyboard.json'
      return [
        {
          name: file.replace(/\.(md|json)$/, ''),
          type: outputType,
          path: join(ctx.outputDir, file),
          mime: file.endsWith('.json') ? 'application/json' : 'text/markdown',
        },
      ]
    },
  }
}
