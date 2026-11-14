import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ManifestValidationError,
  parseCapabilityManifest,
  validateCapabilityManifest,
} from '../src/index'

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))
const read = (name: string) => readFileSync(FIXTURES + name, 'utf8')

describe('CapabilityManifest 校验', () => {
  it.each([
    ['valid-audiobook.yaml', 'audiobook.render'],
    ['valid-novel-edit.yaml', 'novel.edit'],
    ['valid-minimal.yaml', 'storyboard.plan'],
  ])('接受合法 manifest: %s', (file, id) => {
    const manifest = parseCapabilityManifest(read(file))
    expect(manifest.id).toBe(id)
  })

  it('应用默认值', () => {
    const manifest = parseCapabilityManifest(read('valid-minimal.yaml'))
    expect(manifest.credentials.policy).toBe('tenant')
    expect(manifest.permissions.network).toEqual([])
    expect(manifest.permissions.allowShell).toBe(false)
    expect(manifest.resources.gpu).toBe('none')
    expect(manifest.execution.concurrency).toBe(1)
    expect(manifest.inputs[0]?.required).toBe(true)
    expect(manifest.outputs[0]?.multiple).toBe(false)
    expect(manifest.tags).toEqual([])
  })

  it.each([
    ['invalid-bad-id.yaml', 'id'],
    ['invalid-asset-type.yaml', 'outputs.0.assetType'],
    ['invalid-no-default-routing.yaml', 'driver.routing'],
    ['invalid-unknown-field.yaml', ''],
  ])('拒绝非法 manifest: %s', (file, expectedPath) => {
    let error: unknown
    try {
      parseCapabilityManifest(read(file))
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(ManifestValidationError)
    const issues = (error as ManifestValidationError).issues
    expect(issues.length).toBeGreaterThan(0)
    expect(issues.some((issue) => issue.path.startsWith(expectedPath))).toBe(true)
  })

  it('validate 返回结构化结果而不抛错', () => {
    const result = validateCapabilityManifest({ id: 'not valid' })
    expect(result.success).toBe(false)
  })
})
