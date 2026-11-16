export interface Chapter {
  title: string
  body: string
}

const CHAPTER_RE = /^第[零一二三四五六七八九十百千万两\d]+[章节回卷].*$/gm

export function splitChapters(text: string): Chapter[] {
  const matches = [...text.matchAll(CHAPTER_RE)]
  if (matches.length === 0) return [{ title: '全文', body: text }]

  return matches.map((match, index) => {
    const start = match.index ?? 0
    const end = matches[index + 1]?.index ?? text.length
    return {
      title: match[0].trim(),
      body: text.slice(start, end).trim(),
    }
  })
}

function bigrams(value: string): Set<string> {
  const clean = value.replace(/[\s，。！？、；：“”‘’（）《》【】,.!?;:()-]/g, '')
  const result = new Set<string>()
  for (let i = 0; i < clean.length - 1; i += 1) result.add(clean.slice(i, i + 2))
  return result
}

function overlapScore(chapter: string, instruction: string): number {
  const chapterTokens = bigrams(chapter)
  let score = 0
  for (const token of bigrams(instruction)) {
    if (chapterTokens.has(token)) score += 1
  }
  return score
}

/**
 * RAG-lite：按显式章节、指令关键词与就近原则挑选章节，不引入向量库。
 * 返回按原文顺序拼接的上下文，长度不超过 maxChars。
 */
export function selectContext(
  text: string,
  instruction: string,
  chapter?: string,
  maxChars = 12_000,
): string {
  const chapters = splitChapters(text)
  if (chapters.length === 1) return chapters[0]?.body.slice(-maxChars) ?? ''

  const target = chapter?.trim()
  if (target) {
    const matched = chapters
      .map((item, index) => ({ item, index }))
      .filter((entry) => entry.item.title.includes(target))
    if (matched.length > 0) {
      const selected = new Set<number>()
      for (const entry of matched) {
        selected.add(entry.index)
        if (entry.index > 0) selected.add(entry.index - 1)
      }
      return [...selected]
        .sort((a, b) => a - b)
        .map((index) => `### ${chapters[index]?.title}\n${chapters[index]?.body}`)
        .join('\n\n')
    }
  }

  const scored = chapters.map((item, index) => {
    let score = index / chapters.length // 越靠后越优先，适合续写
    if (target && item.title.includes(target)) score += 100
    score += overlapScore(item.body, instruction) / 10
    return { item, index, score }
  })

  const selected = new Set<number>()
  let total = 0
  for (const entry of [...scored].sort((a, b) => b.score - a.score)) {
    if (total + entry.item.body.length > maxChars && selected.size > 0) continue
    selected.add(entry.index)
    total += entry.item.body.length
    if (total >= maxChars) break
  }

  // 选中章节的上一章一并带入，保证衔接。
  for (const index of [...selected]) {
    if (index > 0) selected.add(index - 1)
  }

  return [...selected]
    .sort((a, b) => a - b)
    .map((index) => `### ${chapters[index]?.title}\n${chapters[index]?.body}`)
    .join('\n\n')
}
