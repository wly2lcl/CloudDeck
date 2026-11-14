const BASE = process.env.LOAD_BASE ?? 'http://127.0.0.1:4320'
const TOKEN = process.env.LOAD_TOKEN
const PATH = process.env.LOAD_PATH ?? '/v1/projects'
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY ?? 20)
const DURATION_SECONDS = Number(process.env.LOAD_DURATION ?? 10)

const latencies: number[] = []
let errors = 0
let requests = 0

async function worker(deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    const started = performance.now()
    try {
      const response = await fetch(`${BASE}${PATH}`, {
        headers: TOKEN ? { authorization: `Bearer ${TOKEN}` } : {},
      })
      await response.arrayBuffer()
      if (!response.ok) errors += 1
    } catch {
      errors += 1
    } finally {
      latencies.push(performance.now() - started)
      requests += 1
    }
  }
}

function percentile(sorted: number[], value: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.floor((value / 100) * sorted.length))
  return sorted[index] as number
}

async function main(): Promise<void> {
  console.log(
    `load: base=${BASE} path=${PATH} concurrency=${CONCURRENCY} duration=${DURATION_SECONDS}s`,
  )
  const deadline = Date.now() + DURATION_SECONDS * 1000
  const started = Date.now()
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(deadline)))
  const elapsed = (Date.now() - started) / 1000
  const sorted = latencies.sort((a, b) => a - b)

  const summary = {
    requests,
    errors,
    errorRate: requests === 0 ? 0 : Number(((errors / requests) * 100).toFixed(2)),
    rps: Number((requests / elapsed).toFixed(2)),
    p50Ms: Number(percentile(sorted, 50).toFixed(2)),
    p95Ms: Number(percentile(sorted, 95).toFixed(2)),
    p99Ms: Number(percentile(sorted, 99).toFixed(2)),
  }
  console.log(JSON.stringify(summary, null, 2))

  if (summary.errorRate > 5) process.exit(1)
}

main().catch((error) => {
  console.error('load test 失败', error)
  process.exit(1)
})
