'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { Nav } from '../../../../components/nav'
import { getApiBase, getToken } from '../../../../lib/api'

export default function CollabPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const projectId = params.id
  const [text, setText] = useState('')
  const [status, setStatus] = useState('connecting')
  const [peers, setPeers] = useState(1)
  const ytextRef = useRef<Y.Text | null>(null)

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login')
      return
    }
    const doc = new Y.Doc()
    const base = getApiBase()
    const wsBase = (base || (typeof window !== 'undefined' ? window.location.origin : ''))
      .replace(/^http/, 'ws')
    const provider = new WebsocketProvider(wsBase, `${projectId}_manuscript`, doc, {
      params: { token: getToken() ?? '' },
    })
    const ytext = doc.getText('content')
    ytextRef.current = ytext

    const sync = () => setText(ytext.toString())
    ytext.observe(sync)
    sync()

    const onStatus = (event: { status: string }) => setStatus(event.status)
    provider.on('status', onStatus)
    const onAwareness = () => setPeers(provider.awareness.getStates().size || 1)
    provider.awareness.on('change', onAwareness)
    onAwareness()

    return () => {
      ytext.unobserve(sync)
      provider.off('status', onStatus)
      provider.awareness.off('change', onAwareness)
      provider.destroy()
      doc.destroy()
      ytextRef.current = null
    }
  }, [projectId, router])

  const applyText = (value: string) => {
    const ytext = ytextRef.current
    if (!ytext) return
    const current = ytext.toString()
    if (value === current) return
    let start = 0
    while (start < value.length && start < current.length && value[start] === current[start]) {
      start += 1
    }
    let end = 0
    while (
      end < value.length - start &&
      end < current.length - start &&
      value[value.length - 1 - end] === current[current.length - 1 - end]
    ) {
      end += 1
    }
    const deleteCount = current.length - start - end
    const insert = value.slice(start, value.length - end)
    ytext.doc?.transact(() => {
      if (deleteCount > 0) ytext.delete(start, deleteCount)
      if (insert) ytext.insert(start, insert)
    })
    setText(value)
  }

  return (
    <>
      <Nav />
      <main className="page">
        <header className="page-head">
          <div>
            <p className="eyebrow">实时协作</p>
            <h1>共享稿件</h1>
            <p className="muted">
              状态：{status} · {peers} 人在线 · 草稿实时同步，暂不自动写入资产版本
            </p>
          </div>
          <Link href={`/projects/${projectId}`} className="ghost">
            返回项目
          </Link>
        </header>
        <section className="panel">
          <textarea
            value={text}
            onChange={(event) => applyText(event.target.value)}
            placeholder="开始共同编辑…"
            style={{
              width: '100%',
              minHeight: '60vh',
              resize: 'vertical',
              background: 'transparent',
              color: 'inherit',
              border: 'none',
              outline: 'none',
              font: 'inherit',
              lineHeight: 1.8,
            }}
          />
        </section>
      </main>
    </>
  )
}
