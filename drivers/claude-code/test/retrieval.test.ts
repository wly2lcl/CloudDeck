import { describe, expect, it } from 'vitest'
import { selectContext, splitChapters } from '../src/retrieval'

const NOVEL = [
  '第一章 雨夜',
  '主角在雨夜抵达旧港，灯塔忽明忽暗。',
  '',
  '第二章 灯塔',
  '守塔人提到十年前失踪的船，主角开始怀疑父亲。',
  '',
  '第三章 旧信',
  '旧信里出现了母亲的字迹，线索指向北岛。',
].join('\n')

describe('RAG-lite 检索', () => {
  it('按章节标题切分', () => {
    expect(splitChapters(NOVEL).map((chapter) => chapter.title)).toEqual([
      '第一章 雨夜',
      '第二章 灯塔',
      '第三章 旧信',
    ])
  })

  it('显式章节优先，并带上前一章', () => {
    const context = selectContext(NOVEL, '检查线索', '第三章')
    expect(context).toContain('第二章 灯塔')
    expect(context).toContain('第三章 旧信')
    expect(context).not.toContain('第一章 雨夜')
  })

  it('续写默认取靠后的章节', () => {
    const context = selectContext(NOVEL, '继续写', undefined, 80)
    expect(context).toContain('第三章 旧信')
  })

  it('指令关键词影响排序', () => {
    const context = selectContext(NOVEL, '灯塔 守塔人 船', undefined, 120)
    expect(context).toContain('第二章 灯塔')
  })
})
