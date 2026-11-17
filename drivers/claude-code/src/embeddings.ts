import { selectContext, splitChapters } from './retrieval'

export interface Embedder {
  embed(texts: string[]): Promise<number[][]>
}

export class HttpEmbedder implements Embedder {
  constructor(
    private readonly options: { url: string; model: string; token?: string },
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.options.url.replace(/\/$/, '')}/embeddings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.options.token ? { authorization: `Bearer ${this.options.token}` } : {}),
      },
      body: JSON.stringify({ model: this.options.model, input: texts }),
    })
    if (!response.ok) throw new Error(`embedding 返回 ${response.status}`)
    const payload = (await response.json()) as {
      data?: { embedding?: number[]; index?: number }[]
    }
    const rows = [...(payload.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    const vectors = rows.map((row) => row.embedding ?? [])
    if (vectors.length !== texts.length) throw new Error('embedding 数量不匹配')
    return vectors
  }
}

export function createEmbedderFromEnv(env: NodeJS.ProcessEnv): Embedder | undefined {
  if (!env.EMBEDDING_HTTP_URL || !env.EMBEDDING_MODEL) return undefined
  return new HttpEmbedder({
    url: env.EMBEDDING_HTTP_URL,
    model: env.EMBEDDING_MODEL,
    token: env.EMBEDDING_HTTP_TOKEN,
  })
}

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    dot += (a[i] ?? 0) * (b[i] ?? 0)
    normA += (a[i] ?? 0) ** 2
    normB += (b[i] ?? 0) ** 2
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/** 向量 RAG：按 embedding 相似度选章节，显式章节优先，带相邻章节。 */
export async function selectVectorContext(
  text: string,
  instruction: string,
  chapter: string | undefined,
  embedder: Embedder,
  maxChars = 12_000,
): Promise<string> {
  const chapters = splitChapters(text)
  if (chapters.length <= 1) return selectContext(text, instruction, chapter, maxChars)

  const query = `${instruction}\n${chapter ?? ''}`.trim() || '继续写作'
  const vectors = await embedder.embed([query, ...chapters.map((item) => item.body)])
  const queryVector = vectors[0] as number[]
  const scores = chapters.map((item, index) => {
    const boost = chapter && item.title.includes(chapter) ? 1 : 0
    return {
      index,
      score: cosine(queryVector, vectors[index + 1] ?? []) + boost + index / chapters.length / 100,
    }
  })

  const selected = new Set<number>()
  let total = 0
  for (const entry of [...scores].sort((a, b) => b.score - a.score)) {
    const body = chapters[entry.index]?.body ?? ''
    if (total + body.length > maxChars && selected.size > 0) continue
    selected.add(entry.index)
    total += body.length
    if (total >= maxChars) break
  }
  for (const index of [...selected]) {
    if (index > 0) selected.add(index - 1)
  }

  return [...selected]
    .sort((a, b) => a - b)
    .map((index) => `### ${chapters[index]?.title}\n${chapters[index]?.body}`)
    .join('\n\n')
}
