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

interface Row {
  query: string
  mode: 'lexical' | 'vector'
  chapterHit: boolean
  phraseHit: boolean
  citationCount?: number
  citationPrecision?: number
  chapterCitationPrecision?: number
  line?: string
}

const config = JSON.parse(await readFile('evals/retrieval-cases.json', 'utf8')) as {
  fixture: string
  cases: RetrievalCase[]
}
const novel = await readFile(config.fixture, 'utf8')
const embedder = createEmbedderFromEnv(process.env)
const rows: Row[] = []

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
    const relevant = vector.citations.filter((chunk) => chunk.text.includes(testCase.phrase))
    const chapterRelevant = vector.citations.filter((chunk) =>
      chunk.chapter.includes(testCase.chapter),
    )
    const precision =
      vector.citations.length > 0 ? relevant.length / vector.citations.length : 0
    const chapterPrecision =
      vector.citations.length > 0 ? chapterRelevant.length / vector.citations.length : 0
    rows.push({
      query: testCase.query,
      mode: 'vector',
      chapterHit: vector.citations.some((chunk) => chunk.chapter.includes(testCase.chapter)),
      phraseHit: relevant.length > 0,
      citationCount: vector.citations.length,
      citationPrecision: Number(precision.toFixed(3)),
      chapterCitationPrecision: Number(chapterPrecision.toFixed(3)),
      line: relevant[0] ? `L${relevant[0].startLine}-${relevant[0].endLine}` : undefined,
    })
  }
}

const summary = (['lexical', 'vector'] as const).map((mode) => {
  const subset = rows.filter((row) => row.mode === mode)
  const vectorRows = subset.filter((row) => row.citationPrecision !== undefined)
  return {
    mode,
    cases: subset.length,
    chapterRecall: subset.length ? subset.filter((row) => row.chapterHit).length / subset.length : 0,
    phraseRecall: subset.length ? subset.filter((row) => row.phraseHit).length / subset.length : 0,
    averageChapterCitationPrecision: vectorRows.length
      ? vectorRows.reduce((sum, row) => sum + (row.chapterCitationPrecision ?? 0), 0) / vectorRows.length
      : null,
    averageCitationPrecision: vectorRows.length
      ? vectorRows.reduce((sum, row) => sum + (row.citationPrecision ?? 0), 0) / vectorRows.length
      : null,
    averageCitations: vectorRows.length
      ? vectorRows.reduce((sum, row) => sum + (row.citationCount ?? 0), 0) / vectorRows.length
      : null,
  }
})

await writeFile(
  'retrieval-report.json',
  JSON.stringify({ generatedAt: new Date().toISOString(), rows, summary }, null, 2),
)
for (const row of rows) {
  console.log(
    `${row.query.padEnd(28)} ${row.mode.padEnd(8)} chapter=${row.chapterHit ? 'Y' : 'N'} phrase=${row.phraseHit ? 'Y' : 'N'}${row.citationPrecision !== undefined ? ` precision=${row.citationPrecision}` : ''}${row.line ? ` ${row.line}` : ''}`,
  )
}
for (const item of summary) {
  console.log(
    `\n[${item.mode}] cases=${item.cases} chapterRecall=${(item.chapterRecall * 100).toFixed(1)}% phraseRecall=${(item.phraseRecall * 100).toFixed(1)}%${item.averageCitationPrecision !== null ? ` citationPrecision=${(item.averageCitationPrecision * 100).toFixed(1)}% chapterCitationPrecision=${((item.averageChapterCitationPrecision ?? 0) * 100).toFixed(1)}% avgCitations=${item.averageCitations?.toFixed(1)}` : ''}`,
  )
}
if (!embedder) console.log('未配置 embedding，仅运行词法基线。')
