import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'

interface PnpmDep {
  version?: string
}
interface PnpmProject {
  dependencies?: Record<string, PnpmDep>
  devDependencies?: Record<string, PnpmDep>
}
interface LicenseGroup {
  name: string
  versions: string[]
}

const run = (args: string[]): string => execFileSync('pnpm', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

const projects = JSON.parse(run(['list', '-r', '--depth', 'Infinity', '--json'])) as PnpmProject[]
const licenses = JSON.parse(run(['licenses', 'list', '--json'])) as Record<string, LicenseGroup[]>

const licenseOf = new Map<string, string>()
for (const [license, groups] of Object.entries(licenses)) {
  for (const group of groups) {
    for (const version of group.versions) licenseOf.set(`${group.name}@${version}`, license)
  }
}

const components = new Map<string, { type: string; name: string; version: string; licenses?: { license: { id: string } }[] }>()
for (const project of projects) {
  for (const deps of [project.dependencies, project.devDependencies]) {
    for (const [name, dep] of Object.entries(deps ?? {})) {
      if (!dep.version) continue
      const key = `${name}@${dep.version}`
      if (components.has(key)) continue
      const license = licenseOf.get(key)
      components.set(key, {
        type: 'library',
        name,
        version: dep.version,
        ...(license ? { licenses: [{ license: { id: license } }] } : {}),
      })
    }
  }
}

const bom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: [{ vendor: 'CloudDeck', name: 'pnpm-sbom', version: '1' }],
  },
  components: [...components.values()].sort((a, b) => a.name.localeCompare(b.name)),
}

await writeFile('sbom.json', JSON.stringify(bom, null, 2))
console.log(`SBOM 生成：${bom.components.length} 个组件`)
