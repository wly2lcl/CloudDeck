'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ApiError, api, setTokens } from '../../lib/api'

interface AuthResult {
  accessToken: string
  refreshToken: string
}

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const path = mode === 'login' ? '/v1/auth/login' : '/v1/auth/register'
      const body =
        mode === 'login' ? { email, password } : { email, password, displayName: displayName || undefined }
      const result = await api<AuthResult>(path, { method: 'POST', body, auth: false })
      setTokens(result.accessToken, result.refreshToken)
      router.push('/projects')
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
        <h1>{mode === 'login' ? '登录' : '创建工作空间'}</h1>
        <p className="lede">
          {mode === 'login' ? '使用邮箱登录你的内容工作台。' : '注册后自动创建一个个人租户。'}
        </p>

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
          <label>
            密码
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={8}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </label>
          {mode === 'register' && (
            <label>
              昵称（可选）
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                autoComplete="nickname"
              />
            </label>
          )}

          {error && <p className="error">{error}</p>}

          <button type="submit" disabled={busy}>
            {busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录'}
          </button>
        </form>

        <button
          type="button"
          className="link-button"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login')
            setError(null)
          }}
        >
          {mode === 'login' ? '没有账号？创建一个' : '已有账号？去登录'}
        </button>
      </section>
    </main>
  )
}
