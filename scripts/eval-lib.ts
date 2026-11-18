export interface EvalChecks {
  json?: boolean
  minChars?: number
  maxChars?: number
  minScenes?: number
  minShots?: number
  mustInclude?: string[]
  forbiddenPhrases?: string[]
  maxClicheCount?: number
}

export interface EvalResult {
  passed: boolean
  score: number
  metrics: Record<string, number | boolean>
  reasons: string[]
}

const CLICHES = ['仿佛', '不禁', '嘴角微微上扬', '眸子', '心中一凛']

export function evaluateOutput(output: string, checks: EvalChecks): EvalResult {
  const reasons: string[] = []
  let score = 100
  const metrics: Record<string, number | boolean> = { chars: output.length }

  if (checks.minChars !== undefined && output.length < checks.minChars) {
    score -= 25
    reasons.push(`长度不足 ${output.length} < ${checks.minChars}`)
  }
  if (checks.maxChars !== undefined && output.length > checks.maxChars) {
    score -= 15
    reasons.push(`长度超限 ${output.length} > ${checks.maxChars}`)
  }
  for (const phrase of checks.mustInclude ?? []) {
    const hit = output.includes(phrase)
    metrics[`include:${phrase}`] = hit
    if (!hit) {
      score -= 20
      reasons.push(`缺少关键内容：${phrase}`)
    }
  }
  let clicheCount = 0
  const phrases = checks.forbiddenPhrases ?? (checks.maxClicheCount !== undefined ? CLICHES : [])
  for (const phrase of phrases) {
    const count = output.split(phrase).length - 1
    clicheCount += count
    if (count > 0) {
      score -= 10 * count
      reasons.push(`出现禁用表达：${phrase} ×${count}`)
    }
  }
  metrics.clicheCount = clicheCount
  if (checks.maxClicheCount !== undefined && clicheCount > checks.maxClicheCount) {
    score -= 10
    reasons.push(`套话数量 ${clicheCount} 超过 ${checks.maxClicheCount}`)
  }

  if (checks.json) {
    try {
      const parsed = JSON.parse(output) as {
        acts?: { scenes?: unknown[] }[]
        shots?: unknown[]
      }
      metrics.json = true
      const scenes = parsed.acts?.reduce((sum, act) => sum + (act.scenes?.length ?? 0), 0) ?? 0
      metrics.scenes = scenes
      metrics.shots = parsed.shots?.length ?? 0
      if (checks.minScenes !== undefined && scenes < checks.minScenes) {
        score -= 20
        reasons.push(`场景数不足 ${scenes} < ${checks.minScenes}`)
      }
      if (checks.minShots !== undefined && (parsed.shots?.length ?? 0) < checks.minShots) {
        score -= 20
        reasons.push(`镜头数不足 ${parsed.shots?.length ?? 0} < ${checks.minShots}`)
      }
    } catch {
      metrics.json = false
      score = 0
      reasons.push('输出不是合法 JSON')
    }
  }


  return {
    passed: score >= 70 && reasons.length === 0,
    score: Math.max(0, Math.min(100, score)),
    metrics,
    reasons,
  }
}
