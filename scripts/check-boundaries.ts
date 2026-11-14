import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface SourceFile {
  path: string
  content: string
}

export interface Violation {
  file: string
  specifier: string
  rule: string
}

const IMPORT_RE = /(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g

export function importsOf(content: string): string[] {
  const out: string[] = []
  for (const match of content.matchAll(IMPORT_RE)) {
    const spec = match[1]
    if (spec) out.push(spec)
  }
  return out
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/')
}

function resolveSpecifier(file: string, specifier: string): string {
  if (!specifier.startsWith('.')) return specifier
  const dir = posix.dirname(normalizePath(file))
  return normalizePath(posix.normalize(posix.join(dir, specifier)))
}

interface BoundaryRule {
  name: string
  from: (file: string) => boolean
  forbidden: (resolved: string, file: string) => boolean
}

const isControlPlane = (file: string) => file.startsWith('services/control-plane/')
const isContracts = (file: string) => file.startsWith('packages/contracts/')
const isApp = (file: string) => file.startsWith('apps/')

function capabilityOf(path: string): string | null {
  const match = /^capabilities\/([^/]+)\//.exec(path)
  return match?.[1] ?? null
}

export const RULES: BoundaryRule[] = [
  {
    name: '控制面不得引用执行面与能力实现',
    from: isControlPlane,
    forbidden: (resolved) =>
      /^(drivers|workers|capabilities)\//.test(resolved) ||
      /^services\/job-runner\//.test(resolved) ||
      /^@clouddeck\/(driver-|worker-|capability-)/.test(resolved),
  },
  {
    name: '契约包不得依赖任何业务包',
    from: isContracts,
    forbidden: (resolved) =>
      resolved.startsWith('@clouddeck/') ||
      /^(services|apps|capabilities|drivers|workers)\//.test(resolved),
  },
  {
    name: '能力之间禁止相互引用',
    from: (file) => capabilityOf(file) !== null,
    forbidden: (resolved, file) => {
      const self = capabilityOf(file)
      const target = capabilityOf(resolved)
      if (target) return target !== self
      const pkg = /^@clouddeck\/capability-([^/]+)/.exec(resolved)
      return pkg != null && pkg[1] !== self
    },
  },
  {
    name: '客户端不得引用服务端内部实现',
    from: isApp,
    forbidden: (resolved) =>
      /^@clouddeck\/(control-plane|job-runner)/.test(resolved) ||
      /^services\//.test(resolved),
  },
  {
    name: '引擎适配器不得引用平台服务',
    from: (file) => file.startsWith('drivers/') || file.startsWith('workers/'),
    forbidden: (resolved) => /^(services|apps)\//.test(resolved) || /^@clouddeck\/(control-plane|web)/.test(resolved),
  },
]

export function findViolations(files: SourceFile[]): Violation[] {
  const violations: Violation[] = []
  for (const file of files) {
    const path = normalizePath(file.path)
    for (const specifier of importsOf(file.content)) {
      const resolved = resolveSpecifier(path, specifier)
      for (const rule of RULES) {
        if (rule.from(path) && rule.forbidden(resolved, path)) {
          violations.push({ file: path, specifier, rule: rule.name })
        }
      }
    }
  }
  return violations
}

const SCAN_ROOTS = ['apps', 'services', 'packages', 'capabilities', 'drivers', 'workers']
const EXTENSIONS = ['.ts', '.tsx']
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', 'coverage'])

function walk(dir: string, root: string, out: SourceFile[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      walk(full, root, out)
      continue
    }
    if (!EXTENSIONS.some((ext) => entry.endsWith(ext))) continue
    const relative = normalizePath(full.slice(root.length + 1))
    out.push({ path: relative, content: readFileSync(full, 'utf8') })
  }
}

export function collectSourceFiles(root: string): SourceFile[] {
  const files: SourceFile[] = []
  for (const scanRoot of SCAN_ROOTS) walk(join(root, scanRoot), root, files)
  return files
}

function main(): void {
  const root = normalizePath(fileURLToPath(new URL('..', import.meta.url))).replace(/\/$/, '')
  const files = collectSourceFiles(root)
  const violations = findViolations(files)

  if (violations.length === 0) {
    console.log(`边界检查通过（${files.length} 个源文件）`)
    return
  }

  for (const violation of violations) {
    console.error(`${violation.file}: 禁止引用 ${violation.specifier}（${violation.rule}）`)
  }
  console.error(`发现 ${violations.length} 处越界引用`)
  process.exitCode = 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
}
