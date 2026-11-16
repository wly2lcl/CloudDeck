import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ArtifactSpec, Driver, JobEvent, TaskContext } from '@clouddeck/contracts'
import { selectContext } from './retrieval'

export const CLAUDE_DRIVER_ID = 'drivers/claude-code'
export const RESULT_FILENAME = 'result.md'

const DEFAULT_SYSTEM_PROMPT = [
  '你是 CloudDeck 的内容生产助手，在受控工作区内工作。',
  '只处理提供的输入文件，不要访问工作区之外的路径，不要执行与任务无关的命令。',
  '最终结果必须写入指定的输出文件。',
].join('\n')

export interface ClaudeDriverOptions {
  /** 可执行文件，默认 claude */
  command?: string
  /** 可执行文件前置参数，测试时用于 node fake-cli.mjs */
  commandArgs?: string[]
  model?: string
  permissionMode?: string
  /** 仅在无网络、只挂载工作区的沙箱中开启 */
  skipPermissions?: boolean
}

interface ClaudeStreamEvent {
  type?: string
  subtype?: string
  result?: string
  total_cost_usd?: number
  usage?: { input_tokens?: number; output_tokens?: number }
  message?: { content?: { type?: string; text?: string; name?: string }[] }
  error?: string
}

const at = () => new Date().toISOString()

function truncate(value: string, max = 400): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

function mapLine(line: string): JobEvent[] {
  const trimmed = line.trim()
  if (!trimmed) return []

  let data: ClaudeStreamEvent
  try {
    data = JSON.parse(trimmed) as ClaudeStreamEvent
  } catch {
    return []
  }

  const events: JobEvent[] = []

  if (data.type === 'system') {
    events.push({ type: 'log', level: 'debug', message: 'agent 会话已初始化', at: at() })
    return events
  }

  if (data.type === 'assistant') {
    for (const block of data.message?.content ?? []) {
      if (block.type === 'text' && block.text?.trim()) {
        events.push({ type: 'log', level: 'info', message: truncate(block.text.trim()), at: at() })
      }
      if (block.type === 'tool_use' && block.name) {
        events.push({ type: 'log', level: 'info', message: `调用工具 ${block.name}`, at: at() })
      }
    }
    return events
  }

  if (data.type === 'result') {
    const failed = data.subtype !== undefined && data.subtype !== 'success'
    if (failed) {
      events.push({
        type: 'error',
        code: 'AGENT_FAILED',
        message: data.result ?? data.error ?? 'agent 执行失败',
        retryable: true,
        at: at(),
      })
      return events
    }
    const cost = typeof data.total_cost_usd === 'number' ? data.total_cost_usd : 0
    events.push({
      type: 'usage',
      inputTokens: data.usage?.input_tokens,
      outputTokens: data.usage?.output_tokens,
      costUsd: cost,
      at: at(),
    })
    return events
  }

  if (data.type === 'error') {
    events.push({
      type: 'error',
      code: 'AGENT_FAILED',
      message: data.error ?? 'agent 返回错误',
      retryable: true,
      at: at(),
    })
  }

  return events
}

async function buildPrompt(ctx: TaskContext): Promise<string> {
  const params = ctx.params as Record<string, unknown>
  const mode = typeof params.mode === 'string' ? params.mode : 'continue'
  const instruction =
    typeof params.instruction === 'string' && params.instruction.trim()
      ? params.instruction.trim()
      : '请按模式处理输入文件。'

  const context: string[] = []
  for (const input of ctx.inputs) {
    if (!/^(text\/|application\/json)/.test(input.mime)) continue
    const text = await readFile(input.path, 'utf8').catch(() => '')
    if (!text) continue
    const snippet = selectContext(text, instruction, params.chapter as string | undefined)
    if (snippet) context.push(`### ${input.path}\n${snippet}`)
  }

  return [
    ctx.capability.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    '',
    '## 模式',
    mode,
    '',
    '## 指令',
    instruction,
    '',
    '## 输入文件',
    ...ctx.inputs.map((input) => `- ${input.path} (${input.mime})`),
    ...(context.length > 0
      ? ['', '## 检索到的上下文（RAG-lite，优先使用）', ...context]
      : []),
    '',
    '## 输出要求',
    `将最终结果写入 ${join(ctx.outputDir, RESULT_FILENAME)}。`,
    '只写这一个文件，不要修改输入文件。',
  ].join('\n')
}

function buildArgs(ctx: TaskContext, options: ClaudeDriverOptions): string[] {
  const args = [
    ...(options.commandArgs ?? []),
    '-p',
    '--output-format',
    'stream-json',
    '--include-partial-messages',
    '--add-dir',
    ctx.workspace,
  ]

  if (options.skipPermissions) {
    args.push('--dangerously-skip-permissions')
  } else {
    args.push('--permission-mode', options.permissionMode ?? 'acceptEdits')
  }

  if (options.model) args.push('--model', options.model)

  const sessionId = (ctx.params as Record<string, unknown>).sessionId
  if (typeof sessionId === 'string' && sessionId) args.push('--session-id', sessionId)

  return args
}

function artifactSpec(ctx: TaskContext): ArtifactSpec {
  const output = ctx.capability.outputs?.[0]
  return {
    name: output?.name ?? 'result',
    type: output?.assetType ?? 'document',
    path: join(ctx.outputDir, RESULT_FILENAME),
    mime: 'text/markdown',
  }
}

export function createClaudeCodeDriver(options: ClaudeDriverOptions = {}): Driver {
  const command = options.command ?? process.env.CLAUDE_BIN ?? 'claude'

  return {
    id: CLAUDE_DRIVER_ID,
    protocolVersion: 1,

    async submit() {
      return {}
    },

    async *events(ctx: TaskContext): AsyncGenerator<JobEvent> {
      const queue: JobEvent[] = []
      let finished = false
      let wake: (() => void) | null = null

      const push = (event: JobEvent) => {
        queue.push(event)
        if (wake) {
          const notify = wake
          wake = null
          notify()
        }
      }
      const finish = () => {
        finished = true
        if (wake) {
          const notify = wake
          wake = null
          notify()
        }
      }

      const task = (async () => {
        let buffer = ''
        let sawError = false
        const emit = (events: JobEvent[]) => {
          for (const event of events) {
            if (event.type === 'error') sawError = true
            push(event)
          }
        }

        try {
          const runStream = ctx.commands.runStream?.bind(ctx.commands)
          if (!runStream) throw new Error('当前沙箱不支持流式输出')
          const result = await runStream(
            command,
            buildArgs(ctx, options),
            {
              cwd: ctx.workspace,
              env: ctx.env,
              stdin: await buildPrompt(ctx),
              signal: ctx.signal,
              timeoutMs: ctx.limits.maxDurationMs,
            },
            (chunk) => {
              buffer += chunk
              let index = buffer.indexOf('\n')
              while (index >= 0) {
                const line = buffer.slice(0, index)
                buffer = buffer.slice(index + 1)
                emit(mapLine(line))
                index = buffer.indexOf('\n')
              }
            },
          )

          if (buffer.trim()) emit(mapLine(buffer))

          if (result.aborted) {
            emit([{ type: 'error', code: 'CANCELLED', message: '任务已取消', retryable: false, at: at() }])
            return
          }

          if (result.exitCode !== 0) {
            emit([
              {
                type: 'error',
                code: 'DRIVER_ERROR',
                message: `claude 退出码 ${result.exitCode}: ${truncate(result.stderr.trim(), 300)}`,
                retryable: true,
                at: at(),
              },
            ])
            return
          }

          if (sawError) return

          try {
            await access(join(ctx.outputDir, RESULT_FILENAME))
          } catch {
            emit([
              {
                type: 'error',
                code: 'NO_ARTIFACT',
                message: `agent 未生成 ${RESULT_FILENAME}`,
                retryable: true,
                at: at(),
              },
            ])
            return
          }

          emit([{ type: 'done', at: at() }])
        } catch (error) {
          emit([
            {
              type: 'error',
              code: 'DRIVER_ERROR',
              message: error instanceof Error ? error.message : '驱动执行失败',
              retryable: true,
              at: at(),
            },
          ])
        } finally {
          finish()
        }
      })()

      while (!finished || queue.length > 0) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            wake = resolve
          })
        }
        while (queue.length > 0) yield queue.shift() as JobEvent
      }

      await task
    },

    async cancel() {
      // 取消通过 ctx.signal 传递给沙箱
    },

    async collect(ctx: TaskContext): Promise<ArtifactSpec[]> {
      return [artifactSpec(ctx)]
    },
  }
}
