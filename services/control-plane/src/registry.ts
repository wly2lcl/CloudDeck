import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseCapabilityManifest } from '@clouddeck/contracts'
import { upsertCapability, type Database } from '@clouddeck/db'

export interface SyncResult {
  loaded: string[]
  errors: { directory: string; message: string }[]
}

export async function syncCapabilities(db: Database, capabilitiesDir: string): Promise<SyncResult> {
  const result: SyncResult = { loaded: [], errors: [] }

  let entries: string[]
  try {
    entries = readdirSync(capabilitiesDir)
  } catch {
    return result
  }

  for (const entry of entries) {
    const dir = join(capabilitiesDir, entry)
    if (!statSync(dir).isDirectory()) continue
    const manifestPath = join(dir, 'capability.yaml')
    try {
      const manifest = parseCapabilityManifest(readFileSync(manifestPath, 'utf8'))
      await upsertCapability(db, manifest)
      result.loaded.push(`${manifest.id}@${manifest.version}`)
    } catch (error) {
      result.errors.push({
        directory: entry,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return result
}

export function readFormSchema(
  capabilitiesDir: string,
  capabilityId: string,
  formPath: string,
): unknown {
  try {
    return JSON.parse(readFileSync(join(capabilitiesDir, capabilityId, formPath), 'utf8'))
  } catch {
    return null
  }
}
