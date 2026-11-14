import { describe, expect, it } from 'vitest'
import { findViolations, importsOf, type SourceFile } from './check-boundaries'

const check = (files: SourceFile[]) => findViolations(files)

describe('importsOf', () => {
  it('识别静态导入、导出与动态导入', () => {
    const code = `
      import { a } from './a.js'
      export { b } from '../b'
      const c = await import('@clouddeck/contracts')
    `
    expect(importsOf(code)).toEqual(['./a.js', '../b', '@clouddeck/contracts'])
  })
})

describe('依赖边界', () => {
  it('控制面引用 driver 时报告违规', () => {
    const violations = check([
      { path: 'services/control-plane/src/x.ts', content: "import { run } from '../../../drivers/claude-code'" },
    ])
    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toContain('控制面')
  })

  it('控制面引用 job-runner 时报告违规', () => {
    const violations = check([
      { path: 'services/control-plane/src/x.ts', content: "import { runOnce } from '@clouddeck/job-runner'" },
    ])
    expect(violations).toHaveLength(1)
  })

  it('控制面引用能力包时报告违规', () => {
    const violations = check([
      { path: 'services/control-plane/src/x.ts', content: "import { m } from '@clouddeck/capability-audiobook'" },
    ])
    expect(violations).toHaveLength(1)
  })

  it('契约包引用其他 workspace 包时报告违规', () => {
    const violations = check([
      { path: 'packages/contracts/src/index.ts', content: "import { db } from '@clouddeck/db'" },
    ])
    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toContain('契约包')
  })

  it('能力之间相互引用时报告违规', () => {
    const violations = check([
      {
        path: 'capabilities/novel-edit/src/index.ts',
        content: "import { x } from '../../audiobook-render/src/index.js'",
      },
    ])
    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toContain('能力')
  })

  it('能力引用自身内部文件不算违规', () => {
    const violations = check([
      { path: 'capabilities/novel-edit/src/index.ts', content: "import { x } from './prompt.js'" },
    ])
    expect(violations).toHaveLength(0)
  })

  it('客户端引用服务端实现时报告违规', () => {
    const violations = check([
      { path: 'apps/web/lib/api.ts', content: "import { app } from '@clouddeck/control-plane'" },
    ])
    expect(violations).toHaveLength(1)
  })

  it('正常依赖不报告违规', () => {
    const violations = check([
      {
        path: 'services/control-plane/src/x.ts',
        content: "import { parseCapabilityManifest } from '@clouddeck/contracts'\nimport { z } from 'zod'",
      },
    ])
    expect(violations).toHaveLength(0)
  })
})
