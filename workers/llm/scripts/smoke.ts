import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLlmDriver, createLlmProviderFromEnv } from '../src/index'
import type { TaskContext } from '@clouddeck/contracts'

const MANUSCRIPT = [
  '第一章 风起',
  '夜色沉下来，远处的灯一盏一盏亮起。',
  '张三：“你终于来了，我等了很久。”',
  '李四没有说话，只是把手里的伞递了过去。',
  '第二章 雨落',
  '雨声敲着窗，像有人在门外叩门。',
].join('\n')

async function main(): Promise<void> {
  const provider = createLlmProviderFromEnv(process.env)
  if (!provider) {
    console.error('需要设置 LLM_HTTP_URL 与 LLM_MODEL')
    process.exit(1)
  }
  console.log(`provider=${provider.name} model=${process.env.LLM_MODEL}`)

  const started = Date.now()
  const result = await provider.complete({
    system: '你是测试助手，只输出 JSON。',
    prompt: '输出 JSON：{"ok":true,"message":"可用"}',
    json: true,
  })
  console.log(
    `provider ok in ${Date.now() - started}ms cost=$${result.costUsd} tokens=${result.inputTokens ?? 0}+${result.outputTokens ?? 0}`,
  )
  console.log(`provider text: ${result.text.slice(0, 200)}`)

  const workspace = await mkdtemp(join(tmpdir(), 'clouddeck-smoke-'))
  const outputDir = join(workspace, 'output')
  await mkdir(outputDir, { recursive: true })
  const input = join(workspace, 'manuscript.txt')
  await writeFile(input, MANUSCRIPT)

  const ctx: TaskContext = {
    jobId: 'smoke-script',
    tenantId: 'smoke-tenant',
    capability: {
      id: 'script.generate',
      version: '1.0.0',
      outputs: [{ name: 'script', assetType: 'script', multiple: false }],
    },
    params: { style: '写实、克制' },
    inputs: [
      {
        assetId: 'smoke-asset',
        version: 1,
        type: 'novel_manuscript',
        path: input,
        mime: 'text/plain',
      },
    ],
    workspace,
    outputDir,
    env: {},
    limits: { maxDurationMs: 300_000, maxCostUsd: 5, maxOutputBytes: 10 * 1024 * 1024 },
    signal: new AbortController().signal,
    commands: { run: async () => ({ stdout: '', stderr: '', exitCode: 0 }) },
  }

  const driver = createLlmDriver({ provider })
  let failed = false
  for await (const event of driver.events(ctx)) {
    if (event.type === 'log') console.log(`[${event.level}] ${event.message}`)
    if (event.type === 'usage') console.log(`[usage] $${event.costUsd}`)
    if (event.type === 'error') {
      failed = true
      console.error(`[error] ${event.code}: ${event.message}`)
    }
    if (event.type === 'done') console.log('[done]')
  }

  if (!failed) {
    const script = await readFile(join(outputDir, 'script.md'), 'utf8')
    console.log(`--- script.md (${script.length} chars) ---`)
    console.log(script.split('\n').slice(0, 30).join('\n'))
  }

  await rm(workspace, { recursive: true, force: true })
  if (failed) process.exit(1)
}

main().catch((error) => {
  console.error('smoke 失败', error)
  process.exit(1)
})
