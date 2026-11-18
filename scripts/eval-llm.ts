import { readFile, writeFile } from 'node:fs/promises'
import { createLlmProviderFromEnv } from '../workers/llm/src/providers'
import {
  buildScriptHeuristic,
  buildStoryboardHeuristic,
  scriptPrompt,
  storyboardPrompt,
} from '../workers/llm/src/index'
import { evaluateOutput, type EvalChecks } from './eval-lib'

interface EvalCase {
  id: string
  kind: 'novel' | 'script' | 'storyboard'
  input: string
  instruction?: string
  checks: EvalChecks
}

interface ReportRow {
  caseId: string
  variant: 'model' | 'heuristic' | 'model-error'
  score: number
  passed: boolean
  reasons: string[]
  metrics: Record<string, number | boolean>
}

const NOVEL_SYSTEM = 'capabilities/novel.edit/prompts/novel-edit.md'

async function promptFor(testCase: EvalCase, input: string): Promise<{ system: string; prompt: string }> {
  if (testCase.kind === 'script') {
    return { system: '你是专业中文编剧，只输出 JSON。', prompt: scriptPrompt(input) }
  }
  if (testCase.kind === 'storyboard') {
    return { system: '你是专业分镜师，只输出 JSON。', prompt: storyboardPrompt(input, 2) }
  }
  return {
    system: await readFile(NOVEL_SYSTEM, 'utf8'),
    prompt: `${testCase.instruction ?? '续写下一段。'}\n\n## 稿件\n${input}`,
  }
}

function heuristicOutput(testCase: EvalCase, input: string): string | null {
  if (testCase.kind === 'script') {
    return JSON.stringify(buildScriptHeuristic(input, '灯塔'))
  }
  if (testCase.kind === 'storyboard') {
    return JSON.stringify(buildStoryboardHeuristic(input, { shotsPerScene: 2 }))
  }
  return null
}

async function main(): Promise<void> {
  const config = JSON.parse(await readFile('evals/cases.json', 'utf8')) as { cases: EvalCase[] }
  const provider = createLlmProviderFromEnv(process.env)
  const rows: ReportRow[] = []

  for (const testCase of config.cases) {
    const input = await readFile(testCase.input, 'utf8')
    if (provider) {
      try {
        const { system, prompt } = await promptFor(testCase, input)
        const result = await provider.complete({
          system,
          prompt,
          json: testCase.kind !== 'novel',
        })
        rows.push({
          caseId: testCase.id,
          variant: 'model',
          ...evaluateOutput(result.text, testCase.checks),
        })
      } catch (error) {
        rows.push({
          caseId: testCase.id,
          variant: 'model-error',
          score: 0,
          passed: false,
          reasons: [error instanceof Error ? error.message : String(error)],
          metrics: {},
        })
      }
    }
    const heuristic = heuristicOutput(testCase, input)
    if (heuristic) {
      rows.push({
        caseId: testCase.id,
        variant: 'heuristic',
        ...evaluateOutput(heuristic, testCase.checks),
      })
    }
  }

  await writeFile('eval-report.json', JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2))
  for (const row of rows) {
    console.log(
      `${row.caseId.padEnd(18)} ${row.variant.padEnd(9)} score=${String(row.score).padStart(3)} ${row.passed ? 'PASS' : 'FAIL'}${row.reasons.length ? ` · ${row.reasons.join('; ')}` : ''}`,
    )
  }
  if (!provider) console.log('未配置模型，仅运行启发式基线。')
}

main().catch((error) => {
  console.error('LLM 评测失败', error)
  process.exit(1)
})
