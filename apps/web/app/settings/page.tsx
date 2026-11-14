'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Nav } from '../../components/nav'
import {
  ApiError,
  clearTokens,
  createInvoice,
  createModelCredential,
  createProjectFromTemplate,
  createTemplate,
  deleteModelCredential,
  deleteTemplate,
  getModelCredentials,
  getBillingReconciliation,
  getBillingSummary,
  getCapabilityStates,
  getInvoices,
  getPublicTemplates,
  getQuota,
  getTemplates,
  getTenant,
  getToken,
  importPublicTemplate,
  setCapabilityEnabled,
  setTemplatePublic,
  updateTenantPlan,
  type BillingSummary,
  type CapabilityState,
  type Invoice,
  type ModelCredential,
  type PublicTemplate,
  type Quota,
  type Reconciliation,
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
  const [credentials, setCredentials] = useState<ModelCredential[]>([])
  const [reconciliation, setReconciliation] = useState<Reconciliation | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [publicTemplates, setPublicTemplates] = useState<PublicTemplate[]>([])
  const [credentialProvider, setCredentialProvider] = useState('dashscope')
  const [credentialLabel, setCredentialLabel] = useState('')
  const [credentialSecret, setCredentialSecret] = useState('')
  const [templateName, setTemplateName] = useState('')
  const [templateDescription, setTemplateDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const [
        tenantData,
        quotaData,
        capabilityData,
        templateData,
        summaryData,
        credentialData,
        reconciliationData,
        invoiceData,
        publicTemplateData,
      ] = await Promise.all([
        getTenant(),
        getQuota(),
        getCapabilityStates(),
        getTemplates(),
        getBillingSummary(),
        getModelCredentials(),
        getBillingReconciliation(),
        getInvoices(),
        getPublicTemplates(),
      ])
      setTenant(tenantData)
      setQuota(quotaData)
      setCapabilities(capabilityData)
      setTemplates(templateData)
      setSummary(summaryData)
      setCredentials(credentialData)
      setReconciliation(reconciliationData)
      setInvoices(invoiceData)
      setPublicTemplates(publicTemplateData)
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

  const generateInvoice = async () => {
    try {
      await createInvoice()
      setInvoices(await getInvoices())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '生成账单失败')
    }
  }

  const togglePublish = async (template: Template) => {
    try {
      await setTemplatePublic(template.id, !template.isPublic)
      setTemplates(await getTemplates())
      setPublicTemplates(await getPublicTemplates())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '更新模板失败')
    }
  }

  const importTemplate = async (template: PublicTemplate) => {
    try {
      await importPublicTemplate(template.id)
      setTemplates(await getTemplates())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '导入模板失败')
    }
  }

  const addCredential = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!credentialLabel.trim() || !credentialSecret.trim()) return
    try {
      await createModelCredential({
        provider: credentialProvider,
        label: credentialLabel.trim(),
        secret: credentialSecret.trim(),
      })
      setCredentialLabel('')
      setCredentialSecret('')
      setCredentials(await getModelCredentials())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存凭据失败')
    }
  }

  const removeCredential = async (credential: ModelCredential) => {
    try {
      await deleteModelCredential(credential.id)
      setCredentials((items) => items.filter((item) => item.id !== credential.id))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '删除凭据失败')
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
          <h2>账单对账</h2>
          {reconciliation && (
            <p className="meta">
              预估 {reconciliation.totals.estimatedCostUsd.toFixed(4)} USD · 实际{' '}
              {reconciliation.totals.actualCostUsd.toFixed(4)} USD · 任务{' '}
              {reconciliation.jobs.length}
            </p>
          )}
          {reconciliation && reconciliation.jobs.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>任务</th>
                  <th>能力</th>
                  <th>状态</th>
                  <th>预估</th>
                  <th>实际</th>
                  <th>偏差</th>
                </tr>
              </thead>
              <tbody>
                {reconciliation.jobs.map((job) => (
                  <tr key={job.jobId}>
                    <td>{job.jobId.slice(0, 8)}</td>
                    <td>{job.capabilityId}</td>
                    <td>{job.status}</td>
                    <td>{job.estimatedCostUsd.toFixed(4)}</td>
                    <td>{job.actualCostUsd.toFixed(4)}</td>
                    <td>{job.varianceUsd.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="row" style={{ marginTop: 16 }}>
            <button type="button" onClick={() => void generateInvoice()}>
              生成本期账单
            </button>
          </div>
          <ul className="list" style={{ marginTop: 12 }}>
            {invoices.map((invoice) => (
              <li key={invoice.id} className="list-item">
                <span>
                  <strong>{invoice.period}</strong>
                  <small className="muted">
                    {invoice.totalUsd} USD · {invoice.jobCount} 个任务 · {invoice.status}
                  </small>
                </span>
              </li>
            ))}
          </ul>
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
          <h2>模型凭据（BYOK）</h2>
          <p className="muted">
            密钥以 AES-256-GCM 加密存储，仅显示末四位；任务运行时会按能力声明的密钥名注入。
          </p>
          <form className="row" onSubmit={addCredential} style={{ marginTop: 12 }}>
            <select
              value={credentialProvider}
              onChange={(event) => setCredentialProvider(event.target.value)}
            >
              <option value="dashscope">dashscope / 百炼</option>
              <option value="anthropic">anthropic</option>
              <option value="openai">openai</option>
              <option value="openrouter">openrouter</option>
              <option value="custom">custom</option>
            </select>
            <input
              placeholder="名称，如 百炼主账号"
              value={credentialLabel}
              onChange={(event) => setCredentialLabel(event.target.value)}
            />
            <input
              type="password"
              placeholder="API Key"
              value={credentialSecret}
              onChange={(event) => setCredentialSecret(event.target.value)}
            />
            <button type="submit">保存</button>
          </form>
          <ul className="list" style={{ marginTop: 16 }}>
            {credentials.length === 0 ? (
              <li className="muted">还没有模型凭据。</li>
            ) : (
              credentials.map((credential) => (
                <li key={credential.id} className="list-item">
                  <span>
                    <strong>
                      {credential.label} · {credential.provider}
                    </strong>
                    <small className="muted">{credential.keyHint}</small>
                  </span>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => void removeCredential(credential)}
                  >
                    删除
                  </button>
                </li>
              ))
            )}
          </ul>
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
                  <button type="button" className="ghost" onClick={() => void togglePublish(template)}>
                    {template.isPublic ? '取消公开' : '公开到市场'}
                  </button>
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

          <h2 style={{ marginTop: 24 }}>公开模板市场</h2>
          {publicTemplates.length === 0 ? (
            <p className="muted">还没有公开模板。</p>
          ) : (
            <ul className="list">
              {publicTemplates.map((template) => (
                <li key={template.id} className="list-item">
                  <span>
                    <strong>{template.name}</strong>
                    <small className="muted">{template.description || '暂无描述'}</small>
                  </span>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => void importTemplate(template)}
                  >
                    导入
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  )
}
