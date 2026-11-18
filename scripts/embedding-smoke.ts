import { readFile } from 'node:fs/promises'
import { createEmbedderFromEnv, selectVectorContext } from '../drivers/claude-code/src/embeddings'

async function main(): Promise<void> {
  const embedder = createEmbedderFromEnv(process.env)
  if (!embedder) {
    console.error('缺少 SILICONFLOW_API_KEY（或 EMBEDDING_HTTP_URL/MODEL）')
    process.exit(1)
  }
  const file = process.env.EMBEDDING_SMOKE_FILE ?? 'evals/fixtures/long-novel.md'
  const novel = await readFile(file, 'utf8')
  const query = process.env.EMBEDDING_SMOKE_QUERY ?? '母亲留下的旧信里写了什么？'
  const chapters = novel.split(/^第.+章.*$/m).filter((part) => part.trim())
  const vectors = await embedder.embed([query, ...chapters])
  console.log(`dimensions=${vectors[0]?.length ?? 0} chunks=${chapters.length}`)
  const maxChars = Number(process.env.EMBEDDING_SMOKE_MAX_CHARS ?? 150)
  const context = await selectVectorContext(novel, query, undefined, embedder, maxChars)
  const titles = [...context.matchAll(/^### (.+)$/gm)].map((match) => match[1])
  console.log(`selected=${titles.join(' | ')}`)
  console.log(`contextChars=${context.length}`)
}

main().catch((error) => {
  console.error('Embedding smoke 失败', error)
  process.exit(1)
})
