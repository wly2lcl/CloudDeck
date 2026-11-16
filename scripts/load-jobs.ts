/**
 * 任务队列压测：创建 N 个 demo.echo 任务并统计终态耗时。
 * 需要已登录 token 与项目 id：
 *   API_BASE=http://localhost:4310 TOKEN=... PROJECT_ID=... JOBS=50 pnpm load:jobs
 */
const API_BASE = process.env.API_BASE ?? 'http://localhost:4310'
const TOKEN = process.env.TOKEN ?? ''
const PROJECT_ID = process.env.PROJECT_ID ?? ''
const JOBS = Number(process.env.JOBS ?? 50)
const CAPABILITY = process.env.CAPABILITY ?? 'demo.echo'
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 300_000)

if (!TOKEN || !PROJECT_ID) {
  console.error('缺少 TOKEN 或 PROJECT_ID')
  process.exit(1)
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const payload = (await response.json()) as { data?: T; error?: { message?: string } }
  if (!response.ok) throw new Error(payload.error?.message ?? `HTTP ${response.status}`)
  return payload.data as T
}

async function main(): Promise<void> {
  const ids: string[] = []
  for (let index = 0; index < JOBS; index += 1) {
    const job = await call<{ jobId: string }>(`/v1/projects/${PROJECT_ID}/jobs`, {
      method: 'POST',
      body: JSON.stringify({
        capabilityId: CAPABILITY,
        inputs: [],
        params: { steps: 2, sleepMs: 5 },
      }),
    })
    ids.push(job.jobId)
  }

  const started = Date.now()
  const durations: number[] = []
  let succeeded = 0
  let failed = 0

  while (ids.length > 0 && Date.now() - started < TIMEOUT_MS) {
    for (const id of [...ids]) {
      const job = await call<{ status: string; createdAt: string; finishedAt: string | null }>(
        `/v1/jobs/${id}`,
      )
      if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
        ids.splice(ids.indexOf(id), 1)
        if (job.status === 'succeeded') succeeded += 1
        else failed += 1
        if (job.finishedAt) durations.push(Date.parse(job.finishedAt) - Date.parse(job.createdAt))
      }
    }
    if (ids.length > 0) await new Promise((resolve) => setTimeout(resolve, 500))
  }

  durations.sort((a, b) => a - b)
  const p95 = durations[Math.floor(durations.length * 0.95)] ?? 0
  console.log(
    JSON.stringify(
      {
        submitted: JOBS,
        succeeded,
        failed,
        unfinished: ids.length,
        wallMs: Date.now() - started,
        p50JobMs: durations[Math.floor(durations.length / 2)] ?? 0,
        p95JobMs: p95,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error('压测失败', error)
  process.exit(1)
})
