import { readFile, writeFile } from 'node:fs/promises'
import {
  createEmbedderFromEnv,
  selectVectorContextDetailed,
} from '../drivers/claude-code/src/embeddings'
import { selectContext } from '../drivers/claude-code/src/retrieval'

interface RetrievalCase {
  query: string
  chapter: string
  phrase: string
}

const config = JSON.parse(await readFile('evals/retrieval-cases.json', 'utf8')) as {
  fixture: string
  cases: RetrievalCase[]
}
const novel = await readFile(config.fixture, 'utf8')
const embedder = createEmbedderFromEnv(process.env)
const rows: {
  query: string
  mode: string
  chapterHit: boolean
  phraseHit: boolean
  line?: string
}[] = []

for (const testCase of config.cases) {
  const lexical = selectContext(novel, testCase.query, undefined, 800)
  rows.push({
    query: testCase.query,
    mode: 'lexical',
    chapterHit: lexical.includes(testCase.chapter),
    phraseHit: lexical.includes(testCase.phrase),
  })
  if (embedder) {
    const vector = await selectVectorContextDetailed(novel, testCase.query, undefined, embedder, 800)
    const hit = vector.citations.find((chunk) => chunk.text.includes(testCase.phrase))
    rows.push({
      query: testCase.query,
      mode: 'vector',
      chapterHit: vector.citations.some((chunk) => chunk.chapter.includes(testCase.chapter)),
      phraseHit: Boolean(hit),
      line: hit ? `L${hit.startLine}-${hit.endLine}` : undefined,
    })
  }
}

await writeFile('retrieval-report.json', JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2))
for (const row of rows) {
  console.log(
    `${row.query.padEnd(24)} ${row.mode.padEnd(8)} chapter=${row.chapterHit ? 'Y' : 'N'} phrase=${row.phraseHit ? 'Y' : 'N'}${row.line ? ` ${row.line}` : ''}`,
  )
}
if (!embedder) console.log('未配置 embedding，仅运行词法基线。')
