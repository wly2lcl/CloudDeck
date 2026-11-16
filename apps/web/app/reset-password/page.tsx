'use client'

import { useEffect, useState } from 'react'
import { ApiError, resetPassword } from '../../lib/api'

export default function ResetPasswordPage() {
  const [token, setToken] = useState('')
  const [password, setPassword] = useState('')
  const [done, setDone] = useState(false)
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
      await resetPassword(token, password)
      setDone(true)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '请求失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="shell">
      <section className="card narrow">
        <p className="eyebrow">CloudDeck</p>
        <h1>设置新密码</h1>
        {done ? (
          <>
            <p className="muted">密码已重置，所有旧会话已失效。</p>
            <a className="link-button" href="/login">
              去登录
            </a>
          </>
        ) : (
          <form onSubmit={submit} className="stack">
            <label>
              重置令牌
              <input
                value={token}
                onChange={(event) => setToken(event.target.value)}
                required
                minLength={16}
              />
            </label>
            <label>
              新密码
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
              {busy ? '请稍候…' : '重置密码'}
            </button>
          </form>
        )}
      </section>
    </main>
  )
}
