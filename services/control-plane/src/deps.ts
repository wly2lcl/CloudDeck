import type { Database } from '@clouddeck/db'
import type { Storage } from '@clouddeck/storage'
import type { AppConfig } from './config'
import type { Mailer } from './mailer'

export interface AppDeps {
  db: Database
  storage: Storage
  config: AppConfig
  mailer: Mailer
}
