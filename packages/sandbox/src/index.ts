import { spawn, type ChildProcess } from 'node:child_process'
import { relative, resolve } from 'node:path'
import type { CommandOptions, CommandResult, CommandRunner } from '@clouddeck/contracts'

const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024

const DEFAULT_ALLOWED_ENV = [
  'PATH',
  'HOME',
  'LANG',
  'LC_ALL',
  'TERM',
  'TMPDIR',
  'SHELL',
  'USER',
  'TZ',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
]

function pickEnv(keys: string[], extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of keys) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  return { ...env, ...(extra ?? {}) }
}

function terminate(child: ChildProcess): void {
  const pid = child.pid
  if (!pid) return
  const kill = (signal: NodeJS.Signals) => {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(pid), '/T', '/F'])
      } else {
        process.kill(-pid, signal)
      }
    } catch {
      // 进程已退出
    }
  }
  kill('SIGTERM')
  setTimeout(() => kill('SIGKILL'), 3000).unref()
}

function collect(
  child: ChildProcess,
  options: CommandOptions,
  maxBytes = DEFAULT_MAX_OUTPUT_BYTES,
  onStdout?: (chunk: string) => void,
): Promise<CommandResult> {
  let stdout = ''
  let stderr = ''
  let timedOut = false
  let aborted = false
  let settled = false

  const append = (chunk: Buffer, target: 'stdout' | 'stderr') => {
    const text = chunk.toString('utf8')
    if (target === 'stdout') {
      if (stdout.length + text.length <= maxBytes) stdout += text
      onStdout?.(text)
    } else if (stderr.length + text.length <= maxBytes) {
      stderr += text
    }
  }

  child.stdout?.on('data', (chunk: Buffer) => append(chunk, 'stdout'))
  child.stderr?.on('data', (chunk: Buffer) => append(chunk, 'stderr'))

  child.stdin?.on('error', () => {
    // 子进程可能不读取 stdin
  })
  if (options.stdin !== undefined) child.stdin?.end(options.stdin)
  else child.stdin?.end()

  const timer = options.timeoutMs
    ? setTimeout(() => {
        timedOut = true
        terminate(child)
      }, options.timeoutMs)
    : null

  const onAbort = () => {
    aborted = true
    terminate(child)
  }
  options.signal?.addEventListener('abort', onAbort, { once: true })

  return new Promise((resolvePromise) => {
    const cleanup = () => {
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
    }

    child.on('error', (error) => {
      if (settled) return
      settled = true
      cleanup()
      resolvePromise({ stdout, stderr: `${stderr}${error.message}`, exitCode: -1, timedOut, aborted })
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      cleanup()
      resolvePromise({ stdout, stderr, exitCode: code ?? -1, timedOut, aborted })
    })
  })
}

export interface LocalSandboxOptions {
  allowedEnv?: string[]
  maxOutputBytes?: number
}

export class LocalSandbox implements CommandRunner {
  constructor(private readonly options: LocalSandboxOptions = {}) {}

  async run(command: string, args: string[], options: CommandOptions): Promise<CommandResult> {
    return this.runStream(command, args, options)
  }

  async runStream(
    command: string,
    args: string[],
    options: CommandOptions,
    onStdout?: (chunk: string) => void,
  ): Promise<CommandResult> {
    const env = pickEnv(this.options.allowedEnv ?? DEFAULT_ALLOWED_ENV, options.env)
    const child = spawn(command, args, {
      cwd: options.cwd,
      env,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return collect(
      child,
      options,
      options.maxOutputBytes ?? this.options.maxOutputBytes,
      onStdout,
    )
  }
}

export interface DockerSandboxOptions {
  image: string
  workspaceRoot: string
  network?: 'none' | 'bridge'
  memory?: string
  cpus?: number
  user?: string
  envAllowlist?: string[]
}

export class DockerSandbox implements CommandRunner {
  constructor(private readonly options: DockerSandboxOptions) {}

  async run(command: string, args: string[], options: CommandOptions): Promise<CommandResult> {
    return this.runStream(command, args, options)
  }

  async runStream(
    command: string,
    args: string[],
    options: CommandOptions,
    onStdout?: (chunk: string) => void,
  ): Promise<CommandResult> {
    const root = resolve(this.options.workspaceRoot)
    const cwd = resolve(options.cwd)
    const rel = relative(root, cwd)
    if (rel.startsWith('..')) {
      throw new Error(`工作目录越界: ${options.cwd}`)
    }
    const containerCwd = `/workspace${rel ? `/${rel}` : ''}`

    const envKeys = new Set([
      ...(this.options.envAllowlist ?? []),
      ...Object.keys(options.env ?? {}),
    ])
    const dockerArgs = [
      'run',
      '--rm',
      '--init',
      '-i',
      '--network',
      this.options.network ?? 'none',
      '--read-only',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=512m',
      '--user',
      this.options.user ?? '1000:1000',
      '--memory',
      this.options.memory ?? '2g',
      '--cpus',
      String(this.options.cpus ?? 2),
      '-v',
      `${root}:/workspace`,
      '-w',
      containerCwd,
    ]
    for (const key of envKeys) dockerArgs.push('-e', key)
    dockerArgs.push(this.options.image, command, ...args)

    const child = spawn('docker', dockerArgs, {
      cwd: root,
      env: pickEnv(DEFAULT_ALLOWED_ENV, options.env),
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return collect(child, options, options.maxOutputBytes, onStdout)
  }
}

export type SandboxConfig =
  | ({ driver: 'local' } & LocalSandboxOptions)
  | ({ driver: 'docker' } & DockerSandboxOptions)

export function createCommandRunner(config: SandboxConfig): CommandRunner {
  if (config.driver === 'docker') return new DockerSandbox(config)
  return new LocalSandbox(config)
}
