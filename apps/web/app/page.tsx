import Link from 'next/link'
import { JOB_TRANSITIONS } from '@clouddeck/contracts'
import { getHealth, type Envelope, type HealthData } from '../lib/api'

export default async function HomePage() {
  let health: Envelope<HealthData> | null = null
  let failure: string | null = null

  try {
    health = await getHealth()
  } catch (error) {
    failure = error instanceof Error ? error.message : '无法连接控制面'
  }

  const stateCount = Object.keys(JOB_TRANSITIONS).length

  return (
    <main className="shell">
      <section className="card">
        <p className="eyebrow">M0 · 骨架</p>
        <h1>CloudDeck</h1>
        <p className="lede">AI 内容生产工作台。文档与契约先行，能力按 manifest 插拔。</p>

        <dl className="facts">
          <div>
            <dt>控制面</dt>
            <dd className={health ? 'ok' : 'bad'}>
              {health ? `在线 · ${health.data.version}` : `未连接 · ${failure ?? '未知原因'}`}
            </dd>
          </div>
          <div>
            <dt>任务状态</dt>
            <dd>{stateCount} 个状态已注册</dd>
          </div>
          <div>
            <dt>当前阶段</dt>
            <dd>M0 骨架 / 平台核心前置</dd>
          </div>
        </dl>

        <p className="hint">
          启动方式：<code>pnpm dev</code>，控制面默认 <code>:4310</code>，Web 默认 <code>:3000</code>。
        </p>

        <Link href="/projects" className="cta">
          进入工作台
        </Link>
      </section>
    </main>
  )
}
