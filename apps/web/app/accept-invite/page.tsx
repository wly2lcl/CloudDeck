'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ApiError, acceptInvite, setTokens } from '../../lib/api'

export default function AcceptInvitePage() {
  const router = useRouter()
  const [token, setToken] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('token')
    if (value) setToken(value)
  }, [])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await acceptInvite(token, password, displayName || undefined)
      setTokens(result.accessToken, result.refreshToken)
      router.push('/projects')
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '接受邀请失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="shell">
      <section className="card narrow">
        <p className="eyebrow">CloudDeck</p>
        <h1>接受邀请</h1>
        <p className="lede">设置密码后加入工作空间。已有账号时请输入原密码。</p>
        <form onSubmit={submit} className="stack">
          <label>
            邀请令牌
            <input
              value={token}
              onChange={(event) => setToken(event.target.value)}
              required
              minLength={16}
            />
          </label>
          <label>
            昵称（可选）
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </label>
          <label>
            密码
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={busy}>
            {busy ? '请稍候…' : '加入'}
          </button>
        </form>
      </section>
    </main>
  )
}
