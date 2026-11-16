'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { clearTokens, getMe } from '../lib/api'

export function Nav() {
  const router = useRouter()
  const [platformAdmin, setPlatformAdmin] = useState(false)

  useEffect(() => {
    void getMe()
      .then((me) => setPlatformAdmin(Boolean(me.platformAdmin)))
      .catch(() => setPlatformAdmin(false))
  }, [])

  return (
    <nav className="nav">
      <div className="nav-main">
        <Link href="/projects" className="brand">
          CloudDeck
        </Link>
        <Link href="/projects">项目</Link>
        <Link href="/settings">设置</Link>
        {platformAdmin && <Link href="/admin">管理</Link>}
      </div>
      <button
        type="button"
        className="ghost"
        onClick={() => {
          clearTokens()
          router.push('/login')
        }}
      >
        退出
      </button>
    </nav>
  )
}
