'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Nav } from '../../components/nav'
import { useI18n } from '../../lib/i18n'
import {
  ApiError,
  clearTokens,
  getAdminJobs,
  getAdminTenants,
  getMe,
  getToken,
  updateAdminPlan,
  updateAdminQuota,
  type AdminJob,
  type AdminTenant,
} from '../../lib/api'

export default function AdminPage() {
  const router = useRouter()
  const { t } = useI18n()
  const [tenants, setTenants] = useState<AdminTenant[]>([])
  const [jobs, setJobs] = useState<AdminJob[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const me = await getMe()
      if (!me.platformAdmin) {
        router.replace('/projects')
        return
      }
      const [tenantData, jobData] = await Promise.all([getAdminTenants(), getAdminJobs()])
      setTenants(tenantData)
      setJobs(jobData)
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        clearTokens()
        router.replace('/login')
        return
      }
      setError(caught instanceof Error ? caught.message : '加载失败')
    }
  }, [router])

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login')
      return
    }
    void load()
  }, [load, router])

  const changePlan = async (tenant: AdminTenant, tier: string) => {
    try {
      await updateAdminPlan(tenant.id, tier)
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '更新套餐失败')
    }
  }

  const editQuota = async (tenant: AdminTenant) => {
    const current = tenant.quota
    const maxCost = window.prompt('月度金额上限（USD）', String(current?.maxCostUsd ?? 5))
    if (!maxCost) return
    const maxJobs = window.prompt('月度任务上限', String(current?.maxJobs ?? 50))
    if (!maxJobs) return
    const maxConcurrency = window.prompt('并发上限', String(current?.maxConcurrency ?? 1))
    if (!maxConcurrency) return
    try {
      await updateAdminQuota(tenant.id, {
        maxCostUsd: Number(maxCost),
        maxJobs: Number(maxJobs),
        maxConcurrency: Number(maxConcurrency),
      })
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '更新配额失败')
    }
  }

  return (
    <main className="shell">
      <Nav />
      <header className="page-head">
        <div>
          <p className="eyebrow">{t('admin.eyebrow')}</p>
          <h1>{t('admin.title')}</h1>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <section className="panel">
        <h2>{t('admin.tenants')}</h2>
        <ul className="list">
          {tenants.map((tenant) => (
            <li key={tenant.id} className="list-item">
              <div>
                <strong>{tenant.name}</strong>
                <p className="muted">
                  {tenant.slug} · {tenant.tier} · 本月 {tenant.quota?.jobCount ?? 0} 任务 / $
                  {tenant.quota?.costUsd.toFixed(4) ?? '0'}
                </p>
                <p className="muted">
                  限额：${tenant.quota?.maxCostUsd ?? 0} / {tenant.quota?.maxJobs ?? 0} 任务 /
                  并发 {tenant.quota?.maxConcurrency ?? 0}
                </p>
              </div>
              <div className="row">
                <select
                  value={tenant.tier}
                  onChange={(event) => void changePlan(tenant, event.target.value)}
                >
                  <option value="free">free</option>
                  <option value="pro">pro</option>
                  <option value="team">team</option>
                </select>
                <button type="button" className="ghost" onClick={() => void editQuota(tenant)}>
                  配额
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>{t('admin.jobs')}</h2>
        <ul className="log">
          {jobs.map((job) => (
            <li key={job.id}>
              <strong>{job.capabilityId}</strong>
              <span className="muted">
                {' '}
                · {job.tenantName} · {job.status} · ${job.actualCostUsd.toFixed(4)} ·{' '}
                {new Date(job.createdAt).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
