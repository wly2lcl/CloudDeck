'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Nav } from '../../components/nav'
import {
  ApiError,
  clearTokens,
  createProjectFromTemplate,
  createTemplate,
  deleteTemplate,
  getBillingSummary,
  getCapabilityStates,
  getQuota,
  getTemplates,
  getTenant,
  getToken,
  setCapabilityEnabled,
  updateTenantPlan,
  type BillingSummary,
  type CapabilityState,
  type Quota,
  type Template,
  type Tenant,
} from '../../lib/api'

const TIERS: Tenant['tier'][] = ['free', 'pro', 'team']

export default function SettingsPage() {
  const router = useRouter()
  const [tenant, setTenant] = useState<Tenant | null>(null)
  const [quota, setQuota] = useState<Quota | null>(null)
  const [capabilities, setCapabilities] = useState<CapabilityState[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [summary, setSummary] = useState<BillingSummary | null>(null)
  const [templateName, setTemplateName] = useState('')
  const [templateDescription, setTemplateDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const [tenantData, quotaData, capabilityData, templateData, summaryData] =
        await Promise.all([
          getTenant(),
          getQuota(),
          getCapabilityStates(),
          getTemplates(),
          getBillingSummary(),
        ])
      setTenant(tenantData)
      setQuota(quotaData)
      setCapabilities(capabilityData)
      setTemplates(templateData)
      setSummary(summaryData)
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

  const changePlan = async (tier: Tenant['tier']) => {
    setSaving(true)
    setError(null)
    try {
      setTenant(await updateTenantPlan(tier))
      setQuota(await getQuota())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '切换套餐失败')
    } finally {
      setSaving(false)
    }
  }

  const toggleCapability = async (capability: CapabilityState) => {
    try {
      await setCapabilityEnabled(capability.id, !capability.enabled)
      setCapabilities((items) =>
        items.map((item) =>
          item.id === capability.id ? { ...item, enabled: !item.enabled } : item,
        ),
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '更新能力失败')
    }
  }

  const addTemplate = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!templateName.trim()) return
    try {
      await createTemplate({
        name: templateName.trim(),
        description: templateDescription.trim() || undefined,
      })
      setTemplateName('')
      setTemplateDescription('')
      setTemplates(await getTemplates())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '创建模板失败')
    }
  }

  const useTemplate = async (template: Template) => {
    try {
      const project = await createProjectFromTemplate(template.id)
      router.push(`/projects/${project.id}`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '创建项目失败')
    }
  }

  const removeTemplate = async (template: Template) => {
    try {
      await deleteTemplate(template.id)
      setTemplates((items) => items.filter((item) => item.id !== template.id))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '删除模板失败')
    }
  }

  return (
    <>
      <Nav />
      <main className="page">
        <header className="page-head">
          <div>
            <p className="eyebrow">设置</p>
            <h1>{tenant?.name ?? '租户设置'}</h1>
            {tenant && <p className="muted">当前角色：{tenant.role}</p>}
          </div>
        </header>

        {error && <p className="error">{error}</p>}

        <section className="panel">
          <h2>套餐与配额</h2>
          <div className="row">
            {TIERS.map((tier) => (
              <button
                key={tier}
                type="button"
                className={tenant?.tier === tier ? '' : 'ghost'}
                disabled={saving || tenant?.tier === tier}
                onClick={() => void changePlan(tier)}
              >
                {tier}
              </button>
            ))}
          </div>
          {quota && (
            <p className="meta">
              {quota.period}：成本 {quota.costUsd.toFixed(4)} / {quota.maxCostUsd} USD · 任务{' '}
              {quota.jobCount} / {quota.maxJobs} · 并发 {quota.running} / {quota.maxConcurrency}
            </p>
          )}
        </section>

        <section className="panel">
          <h2>用量明细（按能力）</h2>
          {!summary || summary.items.length === 0 ? (
            <p className="muted">本期还没有用量。</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>能力</th>
                  <th>驱动</th>
                  <th>单位</th>
                  <th>数量</th>
                  <th>金额（USD）</th>
                </tr>
              </thead>
              <tbody>
                {summary.items.map((item) => (
                  <tr key={`${item.capabilityId}-${item.driverId}-${item.unit}`}>
                    <td>{item.capabilityId}</td>
                    <td>{item.driverId}</td>
                    <td>{item.unit}</td>
                    <td>{item.quantity}</td>
                    <td>{item.amountUsd.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="panel">
          <h2>能力开关</h2>
          <div className="stack">
            {capabilities.map((capability) => (
              <label key={capability.id} className="checkbox-row">
                <input
                  type="checkbox"
                  checked={capability.enabled}
                  onChange={() => void toggleCapability(capability)}
                />
                <span>
                  {capability.name}
                  <small className="muted"> · {capability.id}</small>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>项目模板</h2>
          <form className="row" onSubmit={addTemplate}>
            <input
              placeholder="模板名称"
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
            />
            <input
              placeholder="描述（可选）"
              value={templateDescription}
              onChange={(event) => setTemplateDescription(event.target.value)}
            />
            <button type="submit">添加</button>
          </form>
          <ul className="list" style={{ marginTop: 16 }}>
            {templates.map((template) => (
              <li key={template.id} className="list-item">
                <span>
                  <strong>{template.name}</strong>
                  <small className="muted">{template.description || '暂无描述'}</small>
                </span>
                <span className="row">
                  <button type="button" className="ghost" onClick={() => void useTemplate(template)}>
                    用模板建项目
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => void removeTemplate(template)}
                  >
                    删除
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  )
}
