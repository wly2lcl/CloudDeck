'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Nav } from '../../components/nav'
import { ApiError, api, clearTokens, getToken, type Project } from '../../lib/api'

export default function ProjectsPage() {
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      setProjects(await api<Project[]>('/v1/projects'))
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        clearTokens()
        router.replace('/login')
        return
      }
      setError(caught instanceof Error ? caught.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login')
      return
    }
    void load()
  }, [load, router])

  const create = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    try {
      const project = await api<Project>('/v1/projects', {
        method: 'POST',
        body: { name: name.trim() },
      })
      setName('')
      router.push(`/projects/${project.id}`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '创建失败')
    }
  }

  return (
    <>
      <Nav />
      <main className="page">
        <header className="page-head">
          <div>
            <p className="eyebrow">工作台</p>
            <h1>项目</h1>
          </div>
          <form className="row" onSubmit={create}>
            <input
              placeholder="新项目名称"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <button type="submit">创建</button>
          </form>
        </header>

        {error && <p className="error">{error}</p>}
        {loading ? (
          <p className="muted">加载中…</p>
        ) : projects.length === 0 ? (
          <p className="muted">还没有项目。上传一部小说，开始你的第一条内容链。</p>
        ) : (
          <ul className="list">
            {projects.map((project) => (
              <li key={project.id}>
                <Link href={`/projects/${project.id}`} className="list-item">
                  <span>
                    <strong>{project.name}</strong>
                    <small className="muted">{project.description || '暂无描述'}</small>
                  </span>
                  <span className="muted">{new Date(project.createdAt).toLocaleString()}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  )
}
