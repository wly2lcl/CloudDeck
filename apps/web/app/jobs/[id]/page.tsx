'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { Nav } from '../../../components/nav'
import {
  ApiError,
  api,
  clearTokens,
  downloadAsset,
  getToken,
  streamJobEvents,
  type Job,
  type JobEvent,
} from '../../../lib/api'

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled'])

const STATUS_TEXT: Record<string, string> = {
  queued: '排队中',
  provisioning: '准备中',
  running: '执行中',
  finalizing: '收尾中',
  succeeded: '成功',
  failed: '失败',
  cancelled: '已取消',
}

export default function JobPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const jobId = params.id

  const [job, setJob] = useState<Job | null>(null)
  const [events, setEvents] = useState<JobEvent[]>([])
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setJob(await api<Job>(`/v1/jobs/${jobId}`))
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        clearTokens()
        router.replace('/login')
        return
      }
      setError(caught instanceof Error ? caught.message : '加载失败')
    }
  }, [jobId, router])

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login')
      return
    }
    void load()

    const stop = streamJobEvents(
      jobId,
      (event) => {
        setEvents((previous) => [...previous, event].slice(-200))
        if (event.type === 'progress' && typeof event.percent === 'number') {
          setProgress(event.percent)
        }
      },
      () => {
        setProgress(100)
        void load()
      },
    )
    return stop
  }, [jobId, load, router])

  const cancel = async () => {
    try {
      setJob(await api<Job>(`/v1/jobs/${jobId}/cancel`, { method: 'POST' }))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '取消失败')
    }
  }

  const retry = async () => {
    try {
      const next = await api<Job>(`/v1/jobs/${jobId}/retry`, { method: 'POST' })
      router.push(`/jobs/${next.jobId}`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '重试失败')
    }
  }

  const resume = async () => {
    try {
      await api<Job>(`/v1/jobs/${jobId}/resume`, { method: 'POST' })
      window.location.reload()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '续作失败')
    }
  }

  const terminal = job ? TERMINAL.has(job.status) : false
  const shownProgress = job?.status === 'succeeded' ? 100 : progress

  return (
    <>
      <Nav />
      <main className="page">
        <header className="page-head">
          <div>
            <p className="eyebrow">任务</p>
            <h1>
              {job?.capabilityId ?? '加载中…'}{' '}
              <span className={`badge ${job?.status ?? ''}`}>
                {job ? (STATUS_TEXT[job.status] ?? job.status) : '…'}
              </span>
            </h1>
            <p className="muted">
              {job ? `${job.driverId} · ${job.jobId}` : '正在读取任务状态'}
            </p>
          </div>
          <div className="row">
            {job && (
              <Link href={`/projects/${job.projectId}`} className="ghost">
                返回项目
              </Link>
            )}
            {!terminal && (
              <button type="button" className="ghost" onClick={() => void cancel()}>
                取消任务
              </button>
            )}
            {(job?.status === 'failed' || job?.status === 'cancelled') && job?.resumable && (
              <button type="button" className="ghost" onClick={() => void resume()}>
                续作
              </button>
            )}
            {(job?.status === 'failed' || job?.status === 'cancelled') && (
              <button type="button" onClick={() => void retry()}>
                重试
              </button>
            )}
          </div>
        </header>

        {error && <p className="error">{error}</p>}
        {job?.errorCode && (
          <p className="error">
            {job.errorCode}: {job.errorMessage}
          </p>
        )}

        <section className="panel">
          <div className="progress-row">
            <div className="progress">
              <span style={{ width: `${shownProgress}%` }} />
            </div>
            <strong>{shownProgress}%</strong>
          </div>
          <div className="meta">
            已用成本 {job?.actualCostUsd ?? 0} USD · 预估 {job?.estimatedCostUsd ?? 0} USD
            {job?.startedAt && ` · 开始 ${new Date(job.startedAt).toLocaleTimeString()}`}
          </div>
        </section>

        {job && job.outputs.length > 0 && (
          <section className="panel">
            <h2>产物</h2>
            <ul className="list">
              {job.outputs.map((output) => (
                <li key={`${output.assetId}@${output.version}`} className="list-item">
                  <span>
                    <strong>{output.name}</strong>
                    <small className="muted">
                      {output.type} · v{output.version}
                    </small>
                  </span>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => void downloadAsset(output.assetId, output.version)}
                  >
                    下载
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="panel">
          <h2>事件</h2>
          {events.length === 0 ? (
            <p className="muted">等待事件…</p>
          ) : (
            <ol className="log">
              {events.map((event) => (
                <li key={event.seq} className={event.type}>
                  <span className="log-type">{event.type}</span>
                  <span className="log-body">
                    {event.type === 'progress'
                      ? `${event.percent}% ${event.message ?? ''}`
                      : event.type === 'log'
                        ? event.message
                        : event.type === 'error'
                          ? `${event.code}: ${event.message}`
                          : event.type === 'usage'
                            ? `成本 ${event.costUsd} USD`
                            : event.type === 'done'
                              ? '完成'
                              : event.type}
                  </span>
                  <span className="log-time">
                    {new Date(event.at).toLocaleTimeString()}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </main>
    </>
  )
}
