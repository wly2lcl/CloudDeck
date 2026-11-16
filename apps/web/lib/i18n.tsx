'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type Locale = 'zh' | 'en'

const messages: Record<Locale, Record<string, string>> = {
  zh: {
    'nav.projects': '项目',
    'nav.settings': '设置',
    'nav.admin': '管理',
    'nav.logout': '退出',
    'nav.lang': 'EN',
    'login.title': '登录',
    'login.registerTitle': '创建工作空间',
    'login.lede': '使用邮箱登录你的内容工作台。',
    'login.registerLede': '注册后自动创建一个个人租户。',
    'login.email': '邮箱',
    'login.password': '密码',
    'login.name': '昵称（可选）',
    'login.submit': '登录',
    'login.registerSubmit': '注册并登录',
    'login.busy': '请稍候…',
    'login.toRegister': '没有账号？创建一个',
    'login.toLogin': '已有账号？去登录',
    'login.forgot': '忘记密码？',
    'projects.eyebrow': '工作台',
    'projects.title': '项目',
    'projects.lede': '每个项目是一条内容链：稿件、剧本、分镜、音频与视频。',
    'projects.newPlaceholder': '新项目名称',
    'projects.create': '创建',
    'projects.empty': '还没有项目。上传一部小说，开始你的第一条内容链。',
    'projects.noDescription': '暂无描述',
    'job.title': '任务',
    'job.cancel': '取消任务',
    'job.retry': '重试',
    'job.resume': '续作',
    'job.download': '下载',
    'job.logs': '事件日志',
    'job.outputs': '产物',
    'job.cost': '预估 / 实际成本',
    'job.status.queued': '排队中',
    'job.status.provisioning': '准备中',
    'job.status.running': '运行中',
    'job.status.finalizing': '收尾中',
    'job.status.succeeded': '成功',
    'job.status.failed': '失败',
    'job.status.cancelled': '已取消',
    'settings.plan': '套餐与配额',
    'settings.usage': '用量明细（按能力）',
    'settings.reconciliation': '账单对账',
    'settings.capabilities': '能力开关',
    'settings.credentials': '模型凭据（BYOK）',
    'settings.templates': '项目模板',
    'settings.market': '公开模板市场',
    'settings.security': '团队与安全',
    'settings.members': '成员',
    'settings.apiKeys': 'API Key',
    'settings.audit': '审计日志',
    'admin.eyebrow': '平台管理',
    'admin.title': '租户与任务',
    'admin.tenants': '租户',
    'settings.title': '设置',
    'settings.noUsage': '本期还没有用量。',
    'settings.capability': '能力',
    'settings.driver': '驱动',
    'settings.unit': '单位',
    'settings.quantity': '数量',
    'settings.amount': '金额（USD）',
    'settings.jobs': '任务',
    'settings.status': '状态',
    'settings.estimate': '预估',
    'settings.actual': '实际',
    'settings.variance': '偏差',
    'settings.credName': '名称，如 百炼主账号',
    'settings.credKey': 'API Key',
    'settings.save': '保存',
    'settings.noCredentials': '还没有模型凭据。',
    'settings.memberEmail': '已注册用户邮箱',
    'settings.addMember': '添加成员',
    'settings.keyName': 'Key 名称，例如 CI',
    'settings.createKey': '创建 API Key',
    'settings.templateName': '模板名称',
    'settings.templateDesc': '描述（可选）',
    'settings.add': '添加',
    'settings.noPublicTemplates': '还没有公开模板。',
    'settings.quotaButton': '配额',

    'admin.jobs': '最近任务',

  },
  en: {
    'nav.projects': 'Projects',
    'nav.settings': 'Settings',
    'nav.admin': 'Admin',
    'nav.logout': 'Sign out',
    'nav.lang': '中文',
    'login.title': 'Sign in',
    'login.registerTitle': 'Create workspace',
    'login.lede': 'Sign in to your content workbench.',
    'login.registerLede': 'A personal tenant is created automatically.',
    'login.email': 'Email',
    'login.password': 'Password',
    'login.name': 'Display name (optional)',
    'login.submit': 'Sign in',
    'login.registerSubmit': 'Create account',
    'login.busy': 'Working…',
    'login.toRegister': 'No account? Create one',
    'login.toLogin': 'Already have an account? Sign in',
    'login.forgot': 'Forgot password?',
    'projects.eyebrow': 'Workbench',
    'projects.title': 'Projects',
    'projects.lede': 'Each project is a content chain: manuscript, script, storyboard, audio, video.',
    'projects.newPlaceholder': 'New project name',
    'projects.create': 'Create',
    'projects.empty': 'No projects yet. Upload a manuscript to start the first content chain.',
    'projects.noDescription': 'No description',
    'job.title': 'Job',
    'job.cancel': 'Cancel',
    'job.retry': 'Retry',
    'job.resume': 'Resume',
    'job.download': 'Download',
    'job.logs': 'Event log',
    'job.outputs': 'Outputs',
    'job.cost': 'Estimated / actual cost',
    'job.status.queued': 'Queued',
    'job.status.provisioning': 'Provisioning',
    'job.status.running': 'Running',
    'job.status.finalizing': 'Finalizing',
    'job.status.succeeded': 'Succeeded',
    'job.status.failed': 'Failed',
    'job.status.cancelled': 'Cancelled',
    'settings.plan': 'Plan & quota',
    'settings.usage': 'Usage by capability',
    'settings.reconciliation': 'Reconciliation',
    'settings.capabilities': 'Capability toggles',
    'settings.credentials': 'Model credentials (BYOK)',
    'settings.templates': 'Project templates',
    'settings.market': 'Public template market',
    'settings.security': 'Team & security',
    'settings.members': 'Members',
    'settings.apiKeys': 'API keys',
    'settings.audit': 'Audit log',
    'admin.eyebrow': 'Platform admin',
    'admin.title': 'Tenants & jobs',
    'admin.tenants': 'Tenants',
    'settings.title': 'Settings',
    'settings.noUsage': 'No usage this period.',
    'settings.capability': 'Capability',
    'settings.driver': 'Driver',
    'settings.unit': 'Unit',
    'settings.quantity': 'Quantity',
    'settings.amount': 'Amount (USD)',
    'settings.jobs': 'Jobs',
    'settings.status': 'Status',
    'settings.estimate': 'Estimated',
    'settings.actual': 'Actual',
    'settings.variance': 'Variance',
    'settings.credName': 'Name, e.g. Bailian primary',
    'settings.credKey': 'API Key',
    'settings.save': 'Save',
    'settings.noCredentials': 'No model credentials yet.',
    'settings.memberEmail': 'Registered user email',
    'settings.addMember': 'Add member',
    'settings.keyName': 'Key name, e.g. CI',
    'settings.createKey': 'Create API key',
    'settings.templateName': 'Template name',
    'settings.templateDesc': 'Description (optional)',
    'settings.add': 'Add',
    'settings.noPublicTemplates': 'No public templates yet.',
    'settings.quotaButton': 'Quota',

    'admin.jobs': 'Recent jobs',

  },
}

interface I18nContextValue {
  locale: Locale
  setLocale(locale: Locale): void
  t(key: string): string
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'zh',
  setLocale: () => undefined,
  t: (key) => key,
})

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('zh')

  useEffect(() => {
    const stored = localStorage.getItem('clouddeck.locale')
    if (stored === 'en' || stored === 'zh') setLocaleState(stored)
  }, [])

  const setLocale = (next: Locale) => {
    setLocaleState(next)
    localStorage.setItem('clouddeck.locale', next)
  }

  return (
    <I18nContext.Provider
      value={{ locale, setLocale, t: (key) => messages[locale][key] ?? messages.zh[key] ?? key }}
    >
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext)
}
