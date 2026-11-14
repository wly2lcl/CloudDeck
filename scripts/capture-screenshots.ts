import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const API = process.env.CAPTURE_API ?? 'http://127.0.0.1:4310'
const WEB = process.env.CAPTURE_WEB ?? 'http://localhost:3000'
const OUT = 'docs/assets/screenshots'
const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const MANUSCRIPT = [
  '第一章 风起',
  '夜色沉下来，远处的灯一盏一盏亮起。',
  '林夏：“你终于来了，我等了很久。”',
  '陈默没有说话，只是把手里的伞递了过去。',
  '第二章 雨落',
  '雨声敲着窗，像有人在门外叩门。',
  '林夏：“听，像有人在敲门。”',
  '陈默：“是雨。”',
  '第三章 回声',
  '天亮之前，他们决定沿着旧铁轨继续走。',
].join('\n')

interface AuthTokens {
  accessToken: string
  refreshToken: string
}

async function request<T>(
  path: string,
  options: {
    method?: string
    token?: string
    body?: unknown
    form?: FormData
  } = {},
): Promise<T> {
  const headers: Record<string, string> = {}
  if (options.token) headers.authorization = `Bearer ${options.token}`

  let payload: BodyInit | undefined
  if (options.form) {
    payload = options.form
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json'
    payload = JSON.stringify(options.body)
  }

  const response = await fetch(`${API}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: payload,
  })
  const json = (await response.json().catch(() => ({}))) as {
    data?: T
    error?: { message?: string }
  }
  if (!response.ok) {
    throw new Error(
      `${options.method ?? 'GET'} ${path} -> ${response.status}: ${json.error?.message ?? ''}`,
    )
  }
  return json.data as T
}

async function authenticate(): Promise<AuthTokens> {
  const email = `demo+${Date.now()}@clouddeck.dev`
  const password = 'password123'
  try {
    return await request<AuthTokens>('/v1/auth/register', {
      method: 'POST',
      body: { email, password, displayName: 'Demo Author' },
    })
  } catch {
    return request<AuthTokens>('/v1/auth/login', {
      method: 'POST',
      body: { email, password },
    })
  }
}

async function waitJob(token: string, jobId: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const job = await request<{ status: string; errorCode?: string }>(`/v1/jobs/${jobId}`, {
      token,
    })
    if (job.status === 'succeeded') return
    if (job.status === 'failed' || job.status === 'cancelled') {
      throw new Error(`job ${jobId} ${job.status}: ${job.errorCode ?? 'unknown'}`)
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 1000)
    })
  }
  throw new Error(`job ${jobId} timeout`)
}

async function seed(): Promise<{ token: string; refreshToken: string; projectId: string; jobId: string }> {
  const tokens = await authenticate()
  const token = tokens.accessToken

  const project = await request<{ id: string }>('/v1/projects', {
    method: 'POST',
    token,
    body: { name: '星海回声', description: '一部关于雨夜与旧铁轨的长篇小说。' },
  })

  const form = new FormData()
  form.append('file', new Blob([MANUSCRIPT], { type: 'text/plain' }), '星海回声.txt')
  const asset = await request<{ assetId: string }>(
    `/v1/projects/${project.id}/assets?type=novel_manuscript&name=星海回声.txt`,
    { method: 'POST', token, form },
  )

  const scriptJob = await request<{ jobId: string }>(`/v1/projects/${project.id}/jobs`, {
    method: 'POST',
    token,
    body: {
      capabilityId: 'script.generate',
      inputs: [{ assetId: asset.assetId, version: 1 }],
      params: {},
    },
  })
  await waitJob(token, scriptJob.jobId)

  const assetsAfterScript = await request<{ assetId: string; type: string; latestVersion: number }[]>(
    `/v1/projects/${project.id}/assets`,
    { token },
  )
  const script = assetsAfterScript.find((item) => item.type === 'script')
  if (!script) throw new Error('script asset missing')

  const storyboardJob = await request<{ jobId: string }>(`/v1/projects/${project.id}/jobs`, {
    method: 'POST',
    token,
    body: {
      capabilityId: 'storyboard.plan',
      inputs: [{ assetId: script.assetId, version: script.latestVersion }],
      params: { shotsPerScene: 2 },
    },
  })
  await waitJob(token, storyboardJob.jobId)

  const audioJob = await request<{ jobId: string }>(`/v1/projects/${project.id}/jobs`, {
    method: 'POST',
    token,
    body: {
      capabilityId: 'audiobook.render',
      inputs: [{ assetId: asset.assetId, version: 1 }],
      params: {
        defaultVoice: 'narrator',
        voiceMap: '{"旁白":"narrator"}',
        maxCharsPerChunk: 80,
      },
    },
  })
  await waitJob(token, audioJob.jobId)

  await request(`/v1/projects/${project.id}/comments`, {
    method: 'POST',
    token,
    body: { body: '第一章的雨夜氛围很好，建议第二章加快节奏。' },
  })

  return {
    token,
    refreshToken: tokens.refreshToken,
    projectId: project.id,
    jobId: storyboardJob.jobId,
  }
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true })
  const seeded = await seed()

  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 2,
    })
    await context.addInitScript(
      ([accessToken, refreshToken]) => {
        localStorage.setItem('clouddeck.access', accessToken)
        localStorage.setItem('clouddeck.refresh', refreshToken)
      },
      [seeded.token, seeded.refreshToken] as [string, string],
    )

    const page = await context.newPage()

    await page.goto(`${WEB}/projects`, { waitUntil: 'domcontentloaded' })
    await page.getByText('星海回声').first().waitFor({ timeout: 20_000 })
    await page.screenshot({ path: `${OUT}/projects.png` })

    await page.goto(`${WEB}/projects/${seeded.projectId}`, { waitUntil: 'domcontentloaded' })
    await page.getByText('内容链').first().waitFor({ timeout: 20_000 })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${OUT}/project.png` })

    await page.goto(`${WEB}/jobs/${seeded.jobId}`, { waitUntil: 'domcontentloaded' })
    await page.getByText('事件').first().waitFor({ timeout: 20_000 })
    await page.waitForSelector('.log li', { timeout: 20_000 }).catch(() => undefined)
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${OUT}/job.png` })

    const anonymous = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 2,
    })
    const loginPage = await anonymous.newPage()
    await loginPage.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' })
    await loginPage.getByText('登录').first().waitFor({ timeout: 20_000 })
    await loginPage.screenshot({ path: `${OUT}/login.png` })
    await anonymous.close()
  } finally {
    await browser.close()
  }

  console.log(`screenshots saved to ${OUT}`)
}

main().catch((error) => {
  console.error('capture failed', error)
  process.exit(1)
})
