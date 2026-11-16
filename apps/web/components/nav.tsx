'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { clearTokens, getMe } from '../lib/api'
import { useI18n } from '../lib/i18n'

export function Nav() {
  const router = useRouter()
  const [platformAdmin, setPlatformAdmin] = useState(false)
  const { locale, setLocale, t } = useI18n()

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
        <Link href="/projects">{t('nav.projects')}</Link>
        <Link href="/settings">{t('nav.settings')}</Link>
        {platformAdmin && <Link href="/admin">{t('nav.admin')}</Link>}
      </div>
      <button
        type="button"
        className="ghost"
        onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
      >
        {t('nav.lang')}
      </button>
      <button
        type="button"
        className="ghost"
        onClick={() => {
          clearTokens()
          router.push('/login')
        }}
      >
        {t('nav.logout')}
      </button>
    </nav>
  )
}
