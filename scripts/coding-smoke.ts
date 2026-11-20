import { writeFile } from 'node:fs/promises'

const API_BASE = process.env.API_BASE ?? 'http://localhost:4310'
const EMAIL = process.env.EMAIL ?? `coding+${Date.now()}@clouddeck.dev`

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

async function main(): Promise<void> {
  const registered = await call<{ accessToken: string }>('/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: 'password123' }),
  })
  const token = registered.accessToken
  const project = await call<{ id: string }>('/v1/projects', {
    method: 'POST',
    body: JSON.stringify({ name: 'Coding Assist 验证' }),
  }, token)
  const source = 'export function add(a: number, b: number) {\n  return a - b\n}\n'
  const form = new FormData()
  form.append('file', new Blob([source], { type: 'text/plain' }), 'main.ts')
  const upload = await fetch(
    `${API_BASE}/v1/projects/${project.id}/assets?type=code_workspace&name=main.ts`,
    { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form },
  ).then(async (response) => {
    const payload = (await response.json()) as { data?: { assetId: string } }
    if (!response.ok || !payload.data) throw new Error('上传失败')
    return payload.data
  })

  const job = await call<{ jobId: string }>(`/v1/projects/${project.id}/jobs`, {
    method: 'POST',
    body: JSON.stringify({
      capabilityId: 'coding.assist',
      inputs: [{ assetId: upload.assetId, version: 1 }],
      params: {
        instruction: '修复 add 函数，使其返回 a + b，并输出补丁/修改后的代码。',
        mode: 'implement',
      },
    }),
  }, token)
  console.log(`job=${job.jobId}`)

  const started = Date.now()
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    const current = await call<{ status: string; outputs: { assetId: string; version: number }[] }>(
      `/v1/jobs/${job.jobId}`,
      {},
      token,
    )
    if (['succeeded', 'failed', 'cancelled'].includes(current.status)) {
      console.log(`status=${current.status} elapsedMs=${Date.now() - started}`)
      if (current.status !== 'succeeded') process.exit(1)
      const output = current.outputs[0]
      if (output) {
        const content = await call<{ text: string }>(
          `/v1/assets/${output.assetId}/versions/${output.version}/content`,
          {},
          token,
        )
        console.log('--- output ---')
        console.log(content.text.slice(0, 1200))
        await writeFile('/tmp/clouddeck-coding-output.txt', content.text)
      }
      return
    }
    if (Date.now() - started > 10 * 60 * 1000) throw new Error('超时')
  }
}

main().catch((error) => {
  console.error('Coding Assist 失败', error)
  process.exit(1)
})
