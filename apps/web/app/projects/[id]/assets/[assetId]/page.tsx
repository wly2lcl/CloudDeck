'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Nav } from '../../../../../components/nav'
import {
  getAssetDetail,
  getAssetDiff,
  rollbackAssetVersion,
  type AssetDetail,
} from '../../../../../lib/api'

export default function AssetVersionsPage() {
  const params = useParams<{ id: string; assetId: string }>()
  const projectId = params.id
  const assetId = params.assetId
  const [asset, setAsset] = useState<AssetDetail | null>(null)
  const [fromVersion, setFromVersion] = useState(1)
  const [toVersion, setToVersion] = useState(1)
  const [diff, setDiff] = useState<{ fromText: string; toText: string } | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = async () => {
    const detail = await getAssetDetail(assetId)
    setAsset(detail)
    const latest = detail.latestVersion
    setFromVersion(Math.max(1, latest - 1))
    setToVersion(latest)
    if (latest > 1) {
      const result = await getAssetDiff(assetId, Math.max(1, latest - 1), latest)
      setDiff({ fromText: result.fromText, toText: result.toText })
    } else {
      setDiff(null)
    }
  }

  useEffect(() => {
    void load().catch((error) => setMessage(error instanceof Error ? error.message : '加载失败'))
  }, [assetId])

  const compare = async () => {
    try {
      const result = await getAssetDiff(assetId, fromVersion, toVersion)
      setDiff({ fromText: result.fromText, toText: result.toText })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '对比失败')
    }
  }

  const rollback = async () => {
    if (!window.confirm(`将 v${fromVersion} 回滚为新版本？`)) return
    try {
      const result = await rollbackAssetVersion(assetId, fromVersion)
      setMessage(`已回滚为 v${result.version}`)
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '回滚失败')
    }
  }

  const left = diff?.fromText.split('\n') ?? []
  const right = diff?.toText.split('\n') ?? []
  const rows = Math.max(left.length, right.length)

  return (
    <>
      <Nav />
      <main className="page">
        <header className="page-head">
          <div>
            <p className="eyebrow">资产版本</p>
            <h1>{asset?.name ?? '加载中…'}</h1>
            <p className="muted">{asset ? `${asset.type} · 最新 v${asset.latestVersion}` : ''}</p>
          </div>
          <Link href={`/projects/${projectId}`} className="ghost">
            返回项目
          </Link>
        </header>

        {message && <p className="muted">{message}</p>}

        <section className="panel">
          <div className="row">
            <label>
              对比版本
              <select value={fromVersion} onChange={(event) => setFromVersion(Number(event.target.value))}>
                {(asset?.versions ?? []).map((version) => (
                  <option key={version.version} value={version.version}>
                    v{version.version} · {new Date(version.createdAt).toLocaleString()}
                  </option>
                ))}
              </select>
            </label>
            <span>→</span>
            <label>
              目标版本
              <select value={toVersion} onChange={(event) => setToVersion(Number(event.target.value))}>
                {(asset?.versions ?? []).map((version) => (
                  <option key={version.version} value={version.version}>
                    v{version.version}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => void compare()}>
              对比
            </button>
            <button type="button" className="ghost" onClick={() => void rollback()}>
              回滚到对比版本
            </button>
          </div>
        </section>

        {diff && (
          <section className="panel">
            <h2>差异</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <pre style={{ margin: 0, maxHeight: '60vh', overflow: 'auto' }}>
                {Array.from({ length: rows }).map((_, index) => (
                  <div
                    key={index}
                    style={{ background: left[index] === right[index] ? 'transparent' : 'rgba(239,68,68,.15)' }}
                  >
                    {String(index + 1).padStart(4, ' ')} {left[index] ?? ''}
                  </div>
                ))}
              </pre>
              <pre style={{ margin: 0, maxHeight: '60vh', overflow: 'auto' }}>
                {Array.from({ length: rows }).map((_, index) => (
                  <div
                    key={index}
                    style={{ background: left[index] === right[index] ? 'transparent' : 'rgba(34,197,94,.12)' }}
                  >
                    {String(index + 1).padStart(4, ' ')} {right[index] ?? ''}
                  </div>
                ))}
              </pre>
            </div>
          </section>
        )}
      </main>
    </>
  )
}
