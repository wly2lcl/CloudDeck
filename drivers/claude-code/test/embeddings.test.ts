import { describe, expect, it } from 'vitest'
import { selectVectorContext, type Embedder } from '../src/embeddings'

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

const embedder: Embedder = {
  async embed(texts) {
    return texts.map((text) => [
      text.includes('灯塔') ? 1 : 0,
      text.includes('旧信') ? 1 : 0,
      text.includes('雨夜') ? 1 : 0,
    ])
  },
}

describe('向量 RAG', () => {
  it('按 embedding 相似度选择章节', async () => {
    const context = await selectVectorContext(NOVEL, '灯塔 守塔人', undefined, embedder, 80)
    expect(context).toContain('第二章 灯塔')
  })

  it('显式章节优先', async () => {
    const context = await selectVectorContext(NOVEL, '检查', '第三章', embedder)
    expect(context).toContain('第三章 旧信')
    expect(context).toContain('第二章 灯塔')
  })
})
