import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const mode = process.env.FAKE_MODE ?? 'success'
const outputDir = process.env.FAKE_OUTPUT_DIR ?? join(process.cwd(), 'output')

const emit = (payload) => process.stdout.write(`${JSON.stringify(payload)}\n`)

emit({ type: 'system', subtype: 'init' })

let stdin = ''
process.stdin.on('data', (chunk) => {
  stdin += chunk
})

process.stdin.on('end', async () => {
  if (mode === 'slow') {
    emit({ type: 'assistant', message: { content: [{ type: 'text', text: '处理中' }] } })
    await new Promise((resolve) => setTimeout(resolve, 5000))
    return
  }

  if (mode === 'fail') {
    process.stderr.write('fake failure')
    process.exit(2)
  }

  emit({ type: 'assistant', message: { content: [{ type: 'text', text: '已生成结果' }] } })
  emit({
    type: 'result',
    subtype: 'success',
    total_cost_usd: 0.012,
    usage: { input_tokens: 10, output_tokens: 20 },
  })

  if (mode !== 'no-artifact' && outputDir) {
    mkdirSync(outputDir, { recursive: true })
    writeFileSync(join(outputDir, 'result.md'), `# 结果\n\n${stdin.slice(0, 200)}`)
  }
})
