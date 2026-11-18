
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
  if (env.EMBEDDING_HTTP_URL && env.EMBEDDING_MODEL) {
    return new HttpEmbedder({
      url: env.EMBEDDING_HTTP_URL,
      model: env.EMBEDDING_MODEL,
      token: env.EMBEDDING_HTTP_TOKEN,
    })
  }
  if (env.SILICONFLOW_API_KEY) {
    return new HttpEmbedder({
      url: env.SILICONFLOW_EMBEDDING_URL ?? 'https://api.siliconflow.cn/v1',
      model: env.EMBEDDING_MODEL ?? 'BAAI/bge-m3',
      token: env.SILICONFLOW_API_KEY,
    })
  }
  return undefined
}

function bigrams(value: string): Set<string> {
  const clean = value.replace(/[\s，。！？、；：“”‘’（）《》【】,.!?;:()-]/g, '')
  const result = new Set<string>()
  for (let i = 0; i < clean.length - 1; i += 1) result.add(clean.slice(i, i + 2))
  return result
}

function keywordOverlap(text: string, query: string): number {
  const queryTokens = bigrams(query)
  const textTokens = bigrams(text)
  let hits = 0
  for (const token of queryTokens) if (textTokens.has(token)) hits += 1
  return queryTokens.size > 0 ? hits / queryTokens.size : 0
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
export interface RetrievedChunk {
  chapter: string
  startLine: number
  endLine: number
  text: string
  score: number
}

export interface RetrievalResult {
  context: string
  citations: RetrievedChunk[]
}

interface ParagraphChunk {
  chapter: string
  startLine: number
  endLine: number
  text: string
}

function splitParagraphs(text: string): ParagraphChunk[] {
  const lines = text.split('\n')
  const chunks: ParagraphChunk[] = []
  let chapter = '全文'
  let buffer: string[] = []
  let start = 1
  const flush = (endLine: number) => {
    const body = buffer.join('\n').trim()
    if (body) chunks.push({ chapter, startLine: start, endLine, text: body })
    buffer = []
  }
  lines.forEach((line, index) => {
    if (/^第.+章/.test(line.trim())) {
      flush(index)
      chapter = line.trim()
      buffer = [line]
      start = index + 1
      return
    }
    if (!line.trim()) {
      flush(index)
      start = index + 2
      return
    }
    if (buffer.length === 0) start = index + 1
    buffer.push(line)
  })
  flush(lines.length)
  return chunks
}

/** 段落级向量检索：返回上下文与带行号的引用。 */
export async function selectVectorContextDetailed(
  text: string,
  instruction: string,
  chapter: string | undefined,
  embedder: Embedder,
  maxChars = 12_000,
  maxChunks = 10,
): Promise<RetrievalResult> {
  if (!text.trim()) return { context: '', citations: [] }
  const chunks = splitParagraphs(text)
  if (chunks.length === 0) return { context: '', citations: [] }

  const query = `${instruction}\n${chapter ?? ''}`.trim() || '继续写作'
  const vectors = await embedder.embed([query, ...chunks.map((chunk) => chunk.text)])
  const queryVector = vectors[0] as number[]
  const scored = chunks.map((chunk, index) => {
    const boost = chapter && chunk.chapter.includes(chapter) ? 1 : 0
    return {
      chunk,
      score:
        cosine(queryVector, vectors[index + 1] ?? []) +
        boost +
        keywordOverlap(chunk.text, query) * 0.15,
    }
  })

  const selected: RetrievedChunk[] = []
  let total = 0
  for (const entry of scored.sort((a, b) => b.score - a.score)) {
    if (selected.length >= maxChunks) break
    if (total + entry.chunk.text.length > maxChars && selected.length > 0) continue
    selected.push({ ...entry.chunk, score: entry.score })
    total += entry.chunk.text.length
    if (total >= maxChars) break
  }
  selected.sort((a, b) => a.startLine - b.startLine)
  return {
    context: selected
      .map(
        (chunk) =>
          `### ${chunk.chapter}（第${chunk.startLine}-${chunk.endLine}行）\n${chunk.text}`,
      )
      .join('\n\n'),
    citations: selected,
  }
}

/** 兼容旧调用：只返回上下文字符串。 */
export async function selectVectorContext(
  text: string,
  instruction: string,
  chapter: string | undefined,
  embedder: Embedder,
  maxChars = 12_000,
): Promise<string> {
  return (await selectVectorContextDetailed(text, instruction, chapter, embedder, maxChars)).context
}
