'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  ApiError,
  getPublicAssetContent,
  getPublicShare,
  type GraphAsset,
  type PublicShare,
} from '../../../lib/api'

export default function SharePage() {
  const params = useParams<{ token: string }>()
  const token = params.token
  const [share, setShare] = useState<PublicShare | null>(null)
  const [preview, setPreview] = useState<{ name: string; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setShare(await getPublicShare(token))
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '分享加载失败')
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  const openAsset = async (asset: GraphAsset) => {
    try {
      const content = await getPublicAssetContent(token, asset.assetId)
      setPreview({ name: content.name, text: content.text })
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '预览失败')
    }
  }

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">只读分享</p>
          <h1>{share?.project.name ?? '加载中…'}</h1>
          {share?.project.description && <p className="muted">{share.project.description}</p>}
        </div>
        <Link href="/" className="ghost">
          CloudDeck
        </Link>
      </header>

      {error && <p className="error">{error}</p>}

      {preview && (
        <section className="panel">
          <div className="page-head">
            <h2>预览 · {preview.name}</h2>
            <button type="button" className="ghost" onClick={() => setPreview(null)}>
              关闭
            </button>
          </div>
          <pre className="preview-text">{preview.text}</pre>
        </section>
      )}

      <section className="panel">
        <h2>资产（{share?.assets.length ?? 0}）</h2>
        {!share ? (
          <p className="muted">加载中…</p>
        ) : share.assets.length === 0 ? (
          <p className="muted">这个项目还没有资产。</p>
        ) : (
          <ul className="list">
            {share.assets.map((asset) => (
              <li key={asset.assetId} className="list-item">
                <span>
                  <strong>{asset.name}</strong>
                  <small className="muted">
                    {asset.type} · v{asset.latestVersion}
                  </small>
                </span>
                <button type="button" className="ghost" onClick={() => void openAsset(asset)}>
                  预览
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
