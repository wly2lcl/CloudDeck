import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const REQUIRED_PATHS = [
  '/healthz',
  '/v1/auth/login',
  '/v1/projects',
  '/v1/projects/{id}/jobs',
  '/v1/jobs/{id}/events',
  '/v1/capabilities',
  '/v1/billing/quota',
  '/v1/templates',
  '/v1/projects/{id}/comments',
  '/v1/projects/{id}/shares',
]

const specPath = fileURLToPath(new URL('../docs/openapi.yaml', import.meta.url))
const document = parse(readFileSync(specPath, 'utf8')) as {
  openapi?: string
  paths?: Record<string, unknown>
  components?: { securitySchemes?: Record<string, unknown> }
}

const problems: string[] = []
if (!document.openapi?.startsWith('3.')) problems.push('openapi 版本缺失或非 3.x')
if (!document.components?.securitySchemes?.bearerAuth) problems.push('缺少 bearerAuth 安全方案')

const paths = document.paths ?? {}
for (const path of REQUIRED_PATHS) {
  if (!paths[path]) problems.push(`缺少路径 ${path}`)
}

if (problems.length > 0) {
  for (const problem of problems) console.error(problem)
  process.exit(1)
}

console.log(`OpenAPI 校验通过：${Object.keys(paths).length} 个路径`)
