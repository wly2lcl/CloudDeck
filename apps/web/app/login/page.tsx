'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ApiError, api, setTokens } from '../../lib/api'
import { useI18n } from '../../lib/i18n'

interface AuthResult {
  accessToken: string
  refreshToken: string
}

export default function LoginPage() {
  const router = useRouter()
  const { t } = useI18n()
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
        <h1>{mode === 'login' ? t('login.title') : t('login.registerTitle')}</h1>
        <p className="lede">
          {mode === 'login' ? t('login.lede') : t('login.registerLede')}
        </p>

        <form onSubmit={submit} className="stack">
          <label>
            {t('login.email')}
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <label>
            {t('login.password')}
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
              {t('login.name')}
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                autoComplete="nickname"
              />
            </label>
          )}

          {error && <p className="error">{error}</p>}

          <button type="submit" disabled={busy}>
            {busy ? t('login.busy') : mode === 'login' ? t('login.submit') : t('login.registerSubmit')}
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
          {mode === 'login' ? t('login.toRegister') : t('login.toLogin')}
        </button>
        {mode === 'login' && (
          <a className="link-button" href="/forgot-password">
            {t('login.forgot')}
          </a>
        )}
      </section>
    </main>
  )
}
