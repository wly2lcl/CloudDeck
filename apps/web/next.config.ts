import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'

const tracingRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  outputFileTracingRoot: tracingRoot,
  transpilePackages: ['@clouddeck/contracts'],
}

export default nextConfig
