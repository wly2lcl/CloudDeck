import { readFile } from 'node:fs/promises'
import { createEmbedderFromEnv, selectVectorContext } from '../drivers/claude-code/src/embeddings'

async function main(): Promise<void> {
  const embedder = createEmbedderFromEnv(process.env)
  if (!embedder) {
    console.error('缺少 SILICONFLOW_API_KEY（或 EMBEDDING_HTTP_URL/MODEL）')
    process.exit(1)
  }
  const novel = await readFile('evals/fixtures/novel.md', 'utf8')
  const query = '林晚在灯塔里发现了什么？'
  const chapters = novel.split(/^第.+章.*$/m).filter((part) => part.trim())
  const vectors = await embedder.embed([query, ...chapters])
  console.log(`dimensions=${vectors[0]?.length ?? 0} chunks=${chapters.length}`)
  const context = await selectVectorContext(novel, '林晚 灯塔 旧信', undefined, embedder)
  const titles = [...context.matchAll(/^### (.+)$/gm)].map((match) => match[1])
  console.log(`selected=${titles.join(' | ')}`)
  console.log(`contextChars=${context.length}`)
}

main().catch((error) => {
  console.error('Embedding smoke 失败', error)
  process.exit(1)
})
