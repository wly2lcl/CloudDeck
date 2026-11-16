import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const MANUSCRIPT = fileURLToPath(new URL('./fixtures/manuscript.txt', import.meta.url))

test('register, create project, upload, run demo capability', async ({ page }) => {
  const email = `e2e+${Date.now()}@clouddeck.dev`

  await page.goto('/login')
  await page.getByRole('button', { name: '没有账号？创建一个' }).click()
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill('password123')
  await page.getByRole('button', { name: '注册并登录' }).click()
  await expect(page).toHaveURL(/\/projects$/)

  await page.getByPlaceholder('新项目名称').fill('E2E 项目')
  await page.getByRole('button', { name: '创建' }).click()
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/)
  await expect(page.getByRole('heading', { name: '内容链' })).toBeVisible()

  await page.locator('input[type=file]').setInputFiles(MANUSCRIPT)
  await page.getByRole('button', { name: '上传' }).click()
  await expect(page.locator('.list-item strong', { hasText: 'manuscript.txt' })).toBeVisible()

  const demo = page.locator('.list-item', { hasText: '回显示例' })
  await demo.getByRole('link', { name: '运行' }).click()
  await page.getByRole('button', { name: '提交' }).click()
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]+$/)

  await expect(page.getByText('成功')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('demo.echo.result')).toBeVisible()
  await expect(page.getByRole('button', { name: '下载' }).first()).toBeVisible()

  // 访问令牌失效时，前端应使用 refresh token 自动续期并重试。
  await page.evaluate(() => localStorage.setItem('clouddeck.access', 'invalid-token'))
  await page.goto('/projects')
  await expect(page.getByText('E2E 项目')).toBeVisible()

  await page.getByRole('link', { name: '设置' }).click()
  await expect(page.getByText('团队与安全')).toBeVisible()
  await expect(page.getByText('审计日志')).toBeVisible()

  await page.getByRole('button', { name: 'EN' }).click()
  await expect(page.getByRole('link', { name: 'Projects' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()

  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByText('Team & security')).toBeVisible()
})
