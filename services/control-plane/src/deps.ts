import type { Database } from '@clouddeck/db'
import type { Storage } from '@clouddeck/storage'
import type { AppConfig } from './config'

export interface AppDeps {
  db: Database
  storage: Storage
  config: AppConfig
}
