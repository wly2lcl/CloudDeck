'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Nav } from '../../components/nav'
import { ApiError, api, clearTokens, getToken, type Project } from '../../lib/api'
import { useI18n } from '../../lib/i18n'

export default function ProjectsPage() {
  const router = useRouter()
  const { t } = useI18n()
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
            <p className="eyebrow">{t('projects.eyebrow')}</p>
            <h1>{t('projects.title')}</h1>
          </div>
          <form className="row" onSubmit={create}>
            <input
              placeholder={t('projects.newPlaceholder')}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <button type="submit">{t('projects.create')}</button>
          </form>
        </header>

        {error && <p className="error">{error}</p>}
        {loading ? (
          <p className="muted">加载中…</p>
        ) : projects.length === 0 ? (
          <p className="muted">{t('projects.empty')}</p>
        ) : (
          <ul className="list">
            {projects.map((project) => (
              <li key={project.id}>
                <Link href={`/projects/${project.id}`} className="list-item">
                  <span>
                    <strong>{project.name}</strong>
                    <small className="muted">{project.description || t('projects.noDescription')}</small>
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
