'use client'

import { useEffect, useState } from 'react'
import { ApiError, verifyEmail } from '../../lib/api'

export default function VerifyEmailPage() {
  const [status, setStatus] = useState<'pending' | 'done' | 'error'>('pending')
  const [message, setMessage] = useState('正在验证…')

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token')
    if (!token) {
      setStatus('error')
      setMessage('缺少验证令牌')
      return
    }
    void verifyEmail(token)
      .then(() => {
        setStatus('done')
        setMessage('邮箱验证成功。')
      })
      .catch((caught) => {
        setStatus('error')
        setMessage(caught instanceof ApiError ? caught.message : '验证失败')
      })
  }, [])

  return (
    <main className="shell">
      <section className="card narrow">
        <p className="eyebrow">CloudDeck</p>
        <h1>邮箱验证</h1>
        <p className={status === 'error' ? 'error' : 'muted'}>{message}</p>
        <a className="link-button" href="/login">
          返回登录
        </a>
      </section>
    </main>
  )
}
