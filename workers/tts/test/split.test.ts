import { describe, expect, it } from 'vitest'
import { buildChunks, chunkText, splitChapters, splitSegments } from '../src/split'

const BOOK = [
  '第一章 风起',
  '夜色沉下来。',
  '张三：“你终于来了。”',
  '李四没有说话。',
  '第二章 雨落',
  '雨声敲着窗。',
].join('\n')

describe('章节与分段', () => {
  it('按章节标记切分', () => {
    const chapters = splitChapters(BOOK)
    expect(chapters).toHaveLength(2)
    expect(chapters[0]?.title).toBe('第一章 风起')
    expect(chapters[1]?.title).toBe('第二章 雨落')
  })

  it('没有章节标记时退化为单章', () => {
    const chapters = splitChapters('只有一段文字。')
    expect(chapters).toHaveLength(1)
    expect(chapters[0]?.title).toBe('全文')
  })

  it('支持 Markdown 标题', () => {
    const chapters = splitChapters('# 开端\n第一段。\n## 转折\n第二段。')
    expect(chapters).toHaveLength(2)
  })

  it('识别旁白与角色对白', () => {
    const [chapter] = splitChapters(BOOK)
    if (!chapter) throw new Error('缺少章节')
    const segments = splitSegments(chapter)
    expect(segments.some((segment) => segment.kind === 'narration')).toBe(true)
    const dialogue = segments.find((segment) => segment.role === '张三')
    expect(dialogue?.kind).toBe('dialogue')
    expect(dialogue?.text).toBe('你终于来了。')
  })

  it('按最大字数切块', () => {
    const parts = chunkText('甲乙丙丁。戊己庚辛。壬癸。', 6)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.every((part) => part.length <= 6)).toBe(true)
  })

  it('生成带角色与章节信息的块', () => {
    const chapters = splitChapters(BOOK)
    const chunks = buildChunks(chapters, '旁白', 20)
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks[0]?.chapter).toBe(0)
    expect(chunks.some((chunk) => chunk.role === '张三')).toBe(true)
  })
})
