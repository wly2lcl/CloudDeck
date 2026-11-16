import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'
import { I18nProvider } from '../lib/i18n'

export const metadata: Metadata = {
  title: 'CloudDeck',
  description: 'AI 内容生产工作台',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  )
}
