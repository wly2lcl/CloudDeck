import { writeFile } from 'node:fs/promises'

const API_BASE = process.env.API_BASE ?? 'http://localhost:4310'
const CHARS = Number(process.env.CHARS ?? 100_000)
const EMAIL = process.env.EMAIL ?? `stress+${Date.now()}@clouddeck.dev`
const PASSWORD = process.env.PASSWORD ?? 'password123'

async function call<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  })
  const payload = (await response.json()) as { data?: T; error?: { message?: string } }
  if (!response.ok) throw new Error(payload.error?.message ?? `HTTP ${response.status}`)
  return payload.data as T
}

function buildManuscript(chars: number): string {
  const chapters: string[] = []
  let total = 0
  let index = 1
  while (total < chars) {
    const title = `第${index}章 长篇测试`
    const body = `林晚沿着海岸线记录第${index}次潮汐。灯塔在远处闪烁，她把观察写进日志，并核对昨日的风向与浪高。`.repeat(8)
    chapters.push(`${title}\n${body}`)
    total += title.length + body.length
    index += 1
  }
  return chapters.join('\n\n').slice(0, chars)
}

async function poll(token: string, jobId: string, started: number): Promise<void> {
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    const current = await call<{ status: string }>(`/v1/jobs/${jobId}`, {}, token)
    if (['succeeded', 'failed', 'cancelled'].includes(current.status)) {
      console.log(`status=${current.status} elapsedMs=${Date.now() - started}`)
      const logs = await call<{ message?: string }[]>(`/v1/jobs/${jobId}/logs`, {}, token)
      const skipped = logs.filter((log) => log.message?.includes('跳过已完成块')).length
      if (skipped > 0) console.log(`skippedChunks=${skipped}`)
      if (current.status !== 'succeeded' && process.env.ALLOW_FAILURE !== 'true') process.exit(1)
      return
    }
    if (Date.now() - started > 20 * 60 * 1000) throw new Error('超时')
  }
}

async function main(): Promise<void> {
  if (process.env.RESUME_JOB_ID && process.env.TOKEN) {
    const token = process.env.TOKEN
    const jobId = process.env.RESUME_JOB_ID
    const resumed = await call<{ status: string }>(
      `/v1/jobs/${jobId}/resume`,
      { method: 'POST', body: JSON.stringify({}) },
      token,
    )
    console.log(`resumed status=${resumed.status}`)
    await poll(token, jobId, Date.now())
    return
  }
  const registered = await call<{ accessToken: string }>('/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  const token = registered.accessToken
  const project = await call<{ id: string }>('/v1/projects', {
    method: 'POST',
    body: JSON.stringify({ name: '10 万字压测' }),
  }, token)
  const manuscript = buildManuscript(CHARS)
  const form = new FormData()
  form.append('file', new Blob([manuscript], { type: 'text/plain' }), 'longform.txt')
  const uploaded = await fetch(
    `${API_BASE}/v1/projects/${project.id}/assets?type=novel_manuscript&name=longform.txt`,
    { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form },
  ).then(async (response) => {
    const payload = (await response.json()) as { data?: { assetId: string } }
    if (!response.ok || !payload.data) throw new Error('上传失败')
    return payload.data
  })

  const started = Date.now()
  const job = await call<{ jobId: string }>(`/v1/projects/${project.id}/jobs`, {
    method: 'POST',
    body: JSON.stringify({
      capabilityId: 'audiobook.render',
      inputs: [{ assetId: uploaded.assetId, version: 1 }],
      params: { maxCharsPerChunk: 200 },
    }),
  }, token)
  console.log(`job=${job.jobId} chars=${manuscript.length} email=${EMAIL}`)
  await writeFile(
    '/tmp/clouddeck-stress-job.json',
    JSON.stringify({ token, jobId: job.jobId, projectId: project.id }),
  )
  await poll(token, job.jobId, started)
}

main().catch((error) => {
  console.error('长篇压测失败', error)
  process.exit(1)
})
