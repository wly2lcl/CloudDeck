import { readFile } from 'node:fs/promises'

const API_BASE = process.env.API_BASE ?? 'http://localhost:4310'
const EMAIL = process.env.EMAIL ?? `chain+${Date.now()}@clouddeck.dev`

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

async function waitJob(token: string, jobId: string): Promise<{ outputs: { assetId: string; version: number; name: string; type: string }[] }> {
  const started = Date.now()
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const job = await call<{ status: string; outputs: { assetId: string; version: number; name: string; type: string }[] }>(
      `/v1/jobs/${jobId}`,
      {},
      token,
    )
    if (['succeeded', 'failed', 'cancelled'].includes(job.status)) {
      console.log(`job=${jobId} status=${job.status} elapsedMs=${Date.now() - started}`)
      if (job.status !== 'succeeded') process.exit(1)
      return job
    }
    if (Date.now() - started > 15 * 60 * 1000) throw new Error('任务超时')
  }
}

async function main(): Promise<void> {
  const registered = await call<{ accessToken: string }>('/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: 'password123' }),
  })
  const token = registered.accessToken
  const project = await call<{ id: string }>('/v1/projects', {
    method: 'POST',
    body: JSON.stringify({ name: '全链路验证' }),
  }, token)
  const manuscript = await readFile('evals/fixtures/novel.md')
  const form = new FormData()
  form.append('file', new Blob([manuscript], { type: 'text/markdown' }), 'novel.md')
  const upload = await fetch(
    `${API_BASE}/v1/projects/${project.id}/assets?type=novel_manuscript&name=novel.md`,
    { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form },
  ).then(async (response) => {
    const payload = (await response.json()) as { data?: { assetId: string } }
    if (!response.ok || !payload.data) throw new Error('上传失败')
    return payload.data
  })

  const submit = async (capabilityId: string, inputs: { assetId: string; version: number }[], params: Record<string, unknown> = {}) => {
    const job = await call<{ jobId: string }>(`/v1/projects/${project.id}/jobs`, {
      method: 'POST',
      body: JSON.stringify({ capabilityId, inputs, params }),
    }, token)
    return waitJob(token, job.jobId)
  }

  const script = await submit('script.generate', [{ assetId: upload.assetId, version: 1 }])
  const scriptAsset = script.outputs.find((output) => output.type === 'script')
  if (!scriptAsset) throw new Error('缺少剧本产物')
  const storyboard = await submit('storyboard.plan', [{ assetId: scriptAsset.assetId, version: scriptAsset.version }])
  const storyboardAsset = storyboard.outputs.find((output) => output.type === 'storyboard')
  if (!storyboardAsset) throw new Error('缺少分镜产物')
  const audio = await submit('audiobook.render', [{ assetId: upload.assetId, version: 1 }], { maxCharsPerChunk: 200 })
  const audioAsset = audio.outputs.find((output) => output.type === 'audio_track')
  if (!audioAsset) throw new Error('缺少音频产物')
  const video = await submit('video.render', [
    { assetId: storyboardAsset.assetId, version: storyboardAsset.version },
    { assetId: audioAsset.assetId, version: audioAsset.version },
  ])
  const videoAsset = video.outputs.find((output) => output.type === 'video')
  if (!videoAsset) throw new Error('缺少视频产物')
  console.log(`chain=ok video=${videoAsset.assetId}@${videoAsset.version}`)
}

main().catch((error) => {
  console.error('全链路失败', error)
  process.exit(1)
})
