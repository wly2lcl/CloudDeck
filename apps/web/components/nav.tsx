'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { clearTokens } from '../lib/api'

export function Nav() {
  const router = useRouter()

  return (
    <nav className="nav">
      <div className="nav-main">
        <Link href="/projects" className="brand">
          CloudDeck
        </Link>
        <Link href="/projects">项目</Link>
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
