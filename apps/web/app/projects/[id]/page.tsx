'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ContentGraph } from '../../../components/content-graph'
import { Nav } from '../../../components/nav'
import {
  ApiError,
  addComment,
  api,
  clearTokens,
  createShare,
  deleteComment,
  downloadAsset,
  getComments,
  getAssetContent,
  getAssetUrl,
  getProjectGraph,
  getToken,
  type Asset,
  type CapabilitySummary,
  type Comment,
  type Project,
  type ProjectGraph,
} from '../../../lib/api'

const ASSET_TYPES = [
  'novel_manuscript',
  'document',
  'script',
  'story_bible',
  'image',
  'audio_track',
  'video',
]

export default function ProjectPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const projectId = params.id

  const [project, setProject] = useState<Project | null>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [capabilities, setCapabilities] = useState<CapabilitySummary[]>([])
  const [graph, setGraph] = useState<ProjectGraph>({ assets: [], links: [] })
  const [comments, setComments] = useState<Comment[]>([])
  const [commentBody, setCommentBody] = useState('')
  const [assetType, setAssetType] = useState('novel_manuscript')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<{
    name: string
    text?: string
    url?: string
    mime?: string
  } | null>(null)
  const [shareUrl, setShareUrl] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [projectData, assetData, capabilityData, graphData, commentData] =
        await Promise.all([
          api<Project>(`/v1/projects/${projectId}`),
          api<Asset[]>(`/v1/projects/${projectId}/assets`),
          api<CapabilitySummary[]>('/v1/capabilities'),
          getProjectGraph(projectId),
          getComments(projectId),
        ])
      setProject(projectData)
      setAssets(assetData)
      setCapabilities(capabilityData)
      setGraph(graphData)
      setComments(commentData)
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        clearTokens()
        router.replace('/login')
        return
      }
      setError(caught instanceof Error ? caught.message : '加载失败')
    }
  }, [projectId, router])

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login')
      return
    }
    void load()
  }, [load, router])

  const previewAsset = async (asset: Asset) => {
    try {
      if (asset.mime.startsWith('audio/') || asset.mime.startsWith('video/') || asset.mime.startsWith('image/')) {
        const { url, mime } = await getAssetUrl(asset.assetId, asset.latestVersion)
        setPreview({ name: asset.name, url, mime })
        return
      }
      const { text, mime } = await getAssetContent(asset.assetId, asset.latestVersion)
      setPreview({ name: asset.name, text, mime })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '预览失败')
    }
  }

  const share = async () => {
    try {
      const created = await createShare(projectId)
      const url = `${window.location.origin}${created.url}`
      setShareUrl(url)
      await navigator.clipboard?.writeText(url).catch(() => undefined)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '创建分享失败')
    }
  }

  const submitComment = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!commentBody.trim()) return
    try {
      const comment = await addComment(projectId, commentBody.trim())
      setComments((items) => [...items, comment])
      setCommentBody('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '评论失败')
    }
  }

  const removeComment = async (comment: Comment) => {
    try {
      await deleteComment(comment.id)
      setComments((items) => items.filter((item) => item.id !== comment.id))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '删除评论失败')
    }
  }

  const upload = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!file) {
      setError('请选择文件')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const query = `?type=${encodeURIComponent(assetType)}&name=${encodeURIComponent(file.name)}`
      await api<Asset>(`/v1/projects/${projectId}/assets${query}`, {
        method: 'POST',
        formData: form,
      })
      setFile(null)
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '上传失败')
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
            <p className="eyebrow">项目</p>
            <h1>{project?.name ?? '加载中…'}</h1>
            {project?.description && <p className="muted">{project.description}</p>}
          </div>
          <div className="row">
            <button type="button" className="ghost" onClick={() => void share()}>
              创建只读分享
            </button>
            <Link href="/projects" className="ghost">
              返回项目列表
            </Link>
          </div>
        </header>

        {shareUrl && (
          <p className="share-url">
            分享链接（7 天有效）：<code>{shareUrl}</code>
          </p>
        )}

        {error && <p className="error">{error}</p>}

        <section className="panel">
          <h2>上传资产</h2>
          <form className="row" onSubmit={upload}>
            <select value={assetType} onChange={(event) => setAssetType(event.target.value)}>
              {ASSET_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <input
              type="file"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <button type="submit" disabled={busy}>
              {busy ? '上传中…' : '上传'}
            </button>
          </form>
        </section>

        <section className="panel">
          <h2>内容链</h2>
          <ContentGraph
            graph={graph}
            onSelect={(assetId) => {
              const asset = assets.find((item) => item.assetId === assetId)
              if (asset) void previewAsset(asset)
            }}
          />
        </section>

        <section className="panel">
          <h2>评论（{comments.length}）</h2>
          {comments.length === 0 ? (
            <p className="muted">还没有评论，留下第一条协作记录。</p>
          ) : (
            <ul className="comment-list">
              {comments.map((comment) => (
                <li key={comment.id} className="comment-item">
                  <div className="comment-meta">
                    <strong>{comment.author}</strong>
                    <span className="muted">{new Date(comment.createdAt).toLocaleString()}</span>
                  </div>
                  <p>{comment.body}</p>
                  {comment.canDelete && (
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => void removeComment(comment)}
                    >
                      删除
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <form className="row" onSubmit={submitComment} style={{ marginTop: 16 }}>
            <input
              placeholder="写一条评论…"
              value={commentBody}
              onChange={(event) => setCommentBody(event.target.value)}
            />
            <button type="submit">发送</button>
          </form>
        </section>

        <section className="panel">
          <h2>资产（{assets.length}）</h2>
          {assets.length === 0 ? (
            <p className="muted">还没有资产。</p>
          ) : (
            <ul className="list">
              {assets.map((asset) => (
                <li key={asset.assetId} className="list-item">
                  <span>
                    <strong>{asset.name}</strong>
                    <small className="muted">
                      {asset.type} · v{asset.latestVersion} · {Math.ceil(asset.size / 1024)} KB
                    </small>
                  </span>
                  <span className="row">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => void previewAsset(asset)}
                    >
                      预览
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => void downloadAsset(asset.assetId, asset.latestVersion)}
                    >
                      下载
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {preview && (
          <section className="panel">
            <div className="page-head">
              <h2>预览 · {preview.name}</h2>
              <button type="button" className="ghost" onClick={() => setPreview(null)}>
                关闭
              </button>
            </div>
            {preview.text !== undefined ? (
              <pre className="preview-text">{preview.text}</pre>
            ) : preview.mime?.startsWith('audio/') ? (
              <audio controls autoPlay src={preview.url} className="preview-media" />
            ) : preview.mime?.startsWith('video/') ? (
              <video controls autoPlay src={preview.url} className="preview-media" />
            ) : preview.url ? (
              <img src={preview.url} alt={preview.name} className="preview-media" />
            ) : null}
          </section>
        )}

        <section className="panel">
          <h2>运行能力</h2>
          {capabilities.length === 0 ? (
            <p className="muted">没有可用能力，检查 capabilities 目录。</p>
          ) : (
            <ul className="list">
              {capabilities.map((capability) => (
                <li key={`${capability.id}@${capability.version}`} className="list-item">
                  <span>
                    <strong>{capability.name}</strong>
                    <small className="muted">
                      {capability.description} · 预估 {capability.estimate} USD
                    </small>
                  </span>
                  <Link
                    href={`/projects/${projectId}/run/${capability.id}`}
                    className="ghost"
                  >
                    运行
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  )
}
