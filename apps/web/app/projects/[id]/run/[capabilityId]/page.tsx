'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Nav } from '../../../../../components/nav'
import {
  ApiError,
  api,
  clearTokens,
  getToken,
  type Asset,
  type CapabilityDetail,
  type Job,
  type JsonSchema,
} from '../../../../../lib/api'

type FieldSchema = NonNullable<NonNullable<JsonSchema['properties']>[string]>

function defaultFor(field: FieldSchema): string | number | boolean {
  if (field.default !== undefined) return field.default as string | number | boolean
  if (field.type === 'integer' || field.type === 'number') return 0
  if (field.type === 'boolean') return false
  return ''
}

function coerce(field: FieldSchema, raw: string): string | number | boolean {
  if (field.type === 'integer' || field.type === 'number') {
    const value = Number(raw)
    return Number.isFinite(value) ? value : 0
  }
  if (field.type === 'boolean') return raw === 'true'
  return raw
}

export default function RunCapabilityPage() {
  const params = useParams<{ id: string; capabilityId: string }>()
  const router = useRouter()
  const projectId = params.id
  const capabilityId = params.capabilityId

  const [capability, setCapability] = useState<CapabilityDetail | null>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [selections, setSelections] = useState<Record<string, string[]>>({})
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [capabilityData, assetData] = await Promise.all([
        api<CapabilityDetail>(`/v1/capabilities/${capabilityId}`),
        api<Asset[]>(`/v1/projects/${projectId}/assets`),
      ])
      setCapability(capabilityData)
      setAssets(assetData)

      const initialSelections: Record<string, string[]> = {}
      for (const input of capabilityData.manifest.inputs) {
        const candidates = assetData.filter((asset) =>
          input.assetTypes.includes(asset.type),
        )
        const filtered =
          input.name === 'subtitles'
            ? candidates.filter(
                (asset) => asset.mime === 'application/x-subrip' || asset.name.endsWith('.srt'),
              )
            : candidates
        initialSelections[input.name] = filtered[0] ? [filtered[0].assetId] : []
      }
      setSelections(initialSelections)

      const initial: Record<string, string> = {}
      for (const [key, field] of Object.entries(capabilityData.form?.properties ?? {})) {
        initial[key] = String(defaultFor(field))
      }
      setValues(initial)
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        clearTokens()
        router.replace('/login')
        return
      }
      setError(caught instanceof Error ? caught.message : '加载失败')
    }
  }, [capabilityId, projectId, router])

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login')
      return
    }
    void load()
  }, [load, router])

  const assetsFor = (input: { name: string; assetTypes: string[] }) => {
    const candidates = assets.filter((asset) => input.assetTypes.includes(asset.type))
    return input.name === 'subtitles'
      ? candidates.filter(
          (asset) => asset.mime === 'application/x-subrip' || asset.name.endsWith('.srt'),
        )
      : candidates
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!capability) return
    const inputs: { assetId: string; version: number }[] = []
    for (const input of capability.manifest.inputs) {
      const ids = selections[input.name] ?? []
      if (input.required && ids.length === 0) {
        setError(`请选择${input.label ?? input.name}`)
        return
      }
      for (const id of ids) {
        const asset = assets.find((item) => item.assetId === id)
        if (!asset) continue
        inputs.push({ assetId: asset.assetId, version: asset.latestVersion })
      }
    }
    if (inputs.length === 0) {
      setError('请选择输入资产')
      return
    }

    const parsed: Record<string, unknown> = {}
    for (const [key, field] of Object.entries(capability.form?.properties ?? {})) {
      const raw = values[key] ?? String(defaultFor(field))
      parsed[key] = coerce(field, raw)
    }

    setBusy(true)
    setError(null)
    try {
      const job = await api<Job>(`/v1/projects/${projectId}/jobs`, {
        method: 'POST',
        body: {
          capabilityId,
          inputs,
          params: parsed,
        },
      })
      router.push(`/jobs/${job.jobId}`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '提交失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Nav />
      <main className="page">
        <header className="page-head">
          <div>
            <p className="eyebrow">运行能力</p>
            <h1>{capability?.name ?? '加载中…'}</h1>
            {capability && <p className="muted">{capability.description}</p>}
          </div>
        </header>

        {error && <p className="error">{error}</p>}

        {capability && (
          <form className="panel stack" onSubmit={submit}>
            {capability.manifest.inputs.map((input) => {
              const options = assetsFor(input)
              const selected = selections[input.name] ?? []
              if (input.name === 'subtitles') {
                return (
                  <fieldset key={input.name} className="stack">
                    <legend>
                      {input.label ?? input.name}
                      {input.required ? '（必填）' : '（可选，可多选）'}
                    </legend>
                    {options.length === 0 && <p className="muted">没有可用字幕资产</p>}
                    {options.map((asset) => (
                      <label key={asset.assetId}>
                        <input
                          type="checkbox"
                          checked={selected.includes(asset.assetId)}
                          onChange={(event) =>
                            setSelections({
                              ...selections,
                              [input.name]: event.target.checked
                                ? [...selected, asset.assetId]
                                : selected.filter((id) => id !== asset.assetId),
                            })
                          }
                        />
                        {asset.name} · v{asset.latestVersion}
                      </label>
                    ))}
                  </fieldset>
                )
              }
              return (
                <label key={input.name}>
                  {input.label ?? input.name}
                  {input.required ? '（必填）' : '（可选）'}
                  <select
                    value={selected[0] ?? ''}
                    onChange={(event) =>
                      setSelections({
                        ...selections,
                        [input.name]: event.target.value ? [event.target.value] : [],
                      })
                    }
                  >
                    <option value="">不选择</option>
                    {options.map((asset) => (
                      <option key={asset.assetId} value={asset.assetId}>
                        {asset.name}（{asset.type} · v{asset.latestVersion}）
                      </option>
                    ))}
                  </select>
                </label>
              )
            })}

            {Object.entries(capability.form?.properties ?? {}).map(([key, field]) => (
              <label key={key}>
                {field.title ?? key}
                {field.enum ? (
                  <select
                    value={values[key] ?? ''}
                    onChange={(event) =>
                      setValues({ ...values, [key]: event.target.value })
                    }
                  >
                    {field.enum.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : field.type === 'boolean' ? (
                  <select
                    value={values[key] ?? 'false'}
                    onChange={(event) =>
                      setValues({ ...values, [key]: event.target.value })
                    }
                  >
                    <option value="false">否</option>
                    <option value="true">是</option>
                  </select>
                ) : (
                  <input
                    type={field.type === 'integer' || field.type === 'number' ? 'number' : 'text'}
                    value={values[key] ?? ''}
                    min={field.minimum}
                    max={field.maximum}
                    onChange={(event) =>
                      setValues({ ...values, [key]: event.target.value })
                    }
                  />
                )}
              </label>
            ))}

            <div className="meta">
              预估成本 {capability.manifest.billing.estimate} USD · 上限{' '}
              {capability.manifest.execution.maxCostUsd} USD · 单次最长{' '}
              {Math.round(capability.manifest.execution.maxDurationMs / 1000)} 秒
            </div>

            <button type="submit" disabled={busy}>
              {busy ? '提交中…' : '提交任务'}
            </button>
          </form>
        )}
      </main>
    </>
  )
}
