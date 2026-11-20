export interface Chapter {
  index: number
  title: string
  body: string
}

export type SegmentKind = 'narration' | 'dialogue'

export interface Segment {
  id: string
  chapter: number
  role: string
  kind: SegmentKind
  text: string
}

export interface TtsChunk {
  id: string
  chapter: number
  chapterTitle: string
  role: string
  text: string
}

const CHAPTER_RE = /^\s*(第[零一二三四五六七八九十百千万两0-9]+[章节回卷][^\n]*)\s*$/
const SPEAKER_RE = /^([一-龥A-Za-z0-9]{1,8})[：:]\s*(.+)$/
const QUOTE_START_RE = /^[“「"]/

function buildChapters(text: string): { title: string; lines: string[] }[] {
  const lines = text.split(/\r?\n/)
  const chapters: { title: string; lines: string[] }[] = []
  const preamble: string[] = []
  let current: { title: string; lines: string[] } | null = null

  for (const line of lines) {
    const matched = CHAPTER_RE.exec(line)
    if (matched?.[1]) {
      if (current) chapters.push(current)
      current = { title: matched[1].trim(), lines: [] }
      continue
    }
    if (current) current.lines.push(line)
    else preamble.push(line)
  }
  if (current) chapters.push(current)

  if (chapters.length === 0) {
    const markdown: { title: string; lines: string[] }[] = []
    let mdCurrent: { title: string; lines: string[] } | null = null
    for (const line of lines) {
      const heading = /^#{1,2}\s+(.+)$/.exec(line)
      if (heading?.[1]) {
        if (mdCurrent) markdown.push(mdCurrent)
        mdCurrent = { title: heading[1].trim(), lines: [] }
        continue
      }
      if (mdCurrent) mdCurrent.lines.push(line)
    }
    if (mdCurrent) markdown.push(mdCurrent)
    if (markdown.length > 0) return markdown
    return [{ title: '全文', lines }]
  }

  const preambleText = preamble.join('\n').trim()
  if (preambleText) chapters.unshift({ title: '开篇', lines: preamble })

  return chapters
}

export function splitChapters(text: string): Chapter[] {
  return buildChapters(text)
    .map((chapter, index) => ({
      index,
      title: chapter.title,
      body: chapter.lines.join('\n').trim(),
    }))
    .filter((chapter) => chapter.body.length > 0)
    .map((chapter, index) => ({ ...chapter, index }))
}

function stripQuotes(text: string): string {
  return text.replace(/^[“「"]+/, '').replace(/[”」"]+$/, '').trim()
}

export function splitSegments(chapter: Chapter, defaultRole = '旁白'): Segment[] {
  const segments: Segment[] = []
  const paragraphs = chapter.body
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)

  const push = (role: string, text: string, kind: SegmentKind) => {
    const clean = stripQuotes(text)
    if (!clean) return
    segments.push({
      id: `${chapter.index}-${segments.length}`,
      chapter: chapter.index,
      role,
      kind,
      text: clean,
    })
  }

  for (const paragraph of paragraphs) {
    const speaker = SPEAKER_RE.exec(paragraph)
    if (speaker?.[1] && speaker[2] && QUOTE_START_RE.test(speaker[2])) {
      push(speaker[1], speaker[2], 'dialogue')
      continue
    }

    const sentences = paragraph.match(/[^。！？!?]+[。！？!?]?/g) ?? [paragraph]
    for (const sentence of sentences) {
      const text = sentence.trim()
      if (!text) continue
      if (QUOTE_START_RE.test(text)) push('对白', text, 'dialogue')
      else push(defaultRole, text, 'narration')
    }
  }

  return segments
}

export function chunkText(text: string, maxChars: number): string[] {
  const clean = text.trim()
  if (!clean) return []
  if (clean.length <= maxChars) return [clean]

  const result: string[] = []
  let rest = clean
  while (rest.length > maxChars) {
    const candidates = ['。', '！', '？', '；', '，', ' ']
      .map((mark) => rest.lastIndexOf(mark, maxChars))
      .filter((index) => index > 0)
    const cut = candidates.length > 0 ? Math.max(...candidates) + 1 : maxChars
    result.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) result.push(rest)
  return result.filter(Boolean)
}

export function buildChunks(
  chapters: Chapter[],
  defaultRole: string,
  maxChars: number,
): TtsChunk[] {
  const chunks: TtsChunk[] = []
  for (const chapter of chapters) {
    for (const segment of splitSegments(chapter, defaultRole)) {
      const parts = chunkText(segment.text, maxChars)
      parts.forEach((text, index) => {
        const last = chunks[chunks.length - 1]
        if (
          last &&
          last.chapter === chapter.index &&
          last.role === segment.role &&
          last.text.length + text.length <= maxChars
        ) {
          last.text += text
          return
        }
        chunks.push({
          id: `${segment.id}-${index}`,
          chapter: chapter.index,
          chapterTitle: chapter.title,
          role: segment.role,
          text,
        })
      })
    }
  }
  return chunks
}
