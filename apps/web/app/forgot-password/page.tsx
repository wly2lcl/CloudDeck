'use client'

import { useState } from 'react'
import { ApiError, forgotPassword } from '../../lib/api'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await forgotPassword(email)
      setMessage('如果该邮箱已注册，重置令牌已发送。')
      setToken(result.token ?? null)
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
        <h1>重置密码</h1>
        <p className="lede">输入注册邮箱，我们会生成一次性重置令牌。</p>
        <form onSubmit={submit} className="stack">
          <label>
            邮箱
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
            />
          </label>
          {error && <p className="error">{error}</p>}
          {message && <p className="muted">{message}</p>}
          {token && (
            <p className="muted">
              开发环境令牌：<code>{token}</code>
            </p>
          )}
          <button type="submit" disabled={busy}>
            {busy ? '请稍候…' : '获取重置令牌'}
          </button>
        </form>
        {token && (
          <a className="link-button" href={`/reset-password?token=${encodeURIComponent(token)}`}>
            去设置新密码
          </a>
        )}
        <a className="link-button" href="/login">
          返回登录
        </a>
      </section>
    </main>
  )
}
