'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { formatSrtTime, parseSrt, serializeSrt, type SubtitleCue } from '@clouddeck/contracts'
import { Nav } from '../../../../components/nav'
import { api, getAssetContent, type Asset } from '../../../../lib/api'

function clock(ms: number): string {
  return formatSrtTime(ms)
}

export default function SubtitleEditorPage() {
  const params = useParams<{ id: string }>()
  const projectId = params.id
  const [assets, setAssets] = useState<Asset[]>([])
  const [selected, setSelected] = useState('')
  const [cues, setCues] = useState<SubtitleCue[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [fontSize, setFontSize] = useState('20')
  const [alignment, setAlignment] = useState('2')
  const [marginV, setMarginV] = useState('24')
  const [outline, setOutline] = useState('1')

  const subtitles = assets.filter(
    (asset) => asset.mime === 'application/x-subrip' || asset.name.endsWith('.srt'),
  )

  const loadAssets = async () => {
    const list = await api<Asset[]>(`/v1/projects/${projectId}/assets`)
    setAssets(list)
    return list
  }

  useEffect(() => {
    void loadAssets()
      .then((list) => {
        const first = list.find(
          (asset) => asset.mime === 'application/x-subrip' || asset.name.endsWith('.srt'),
        )
        if (first) setSelected(first.assetId)
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : '加载失败'))
  }, [projectId])

  useEffect(() => {
    if (!selected) return
    const asset = assets.find((item) => item.assetId === selected)
    if (!asset) return
    void getAssetContent(asset.assetId, asset.latestVersion)
      .then((content) => setCues(parseSrt(content.text)))
      .catch((error) => setMessage(error instanceof Error ? error.message : '字幕解析失败'))
  }, [selected, assets])

  const updateCue = (index: number, patch: Partial<SubtitleCue>) => {
    setCues((items) => items.map((cue, i) => (i === index ? { ...cue, ...patch } : cue)))
  }

  const addCue = () => {
    const last = cues[cues.length - 1]
    const start = last?.endMs ?? 0
    setCues([...cues, { index: cues.length + 1, startMs: start, endMs: start + 2000, text: '新字幕' }])
  }

  const removeCue = (index: number) => {
    setCues(cues.filter((_, i) => i !== index).map((cue, i) => ({ ...cue, index: i + 1 })))
  }

  const style = `FontName=Noto Sans CJK SC,FontSize=${fontSize},PrimaryColour=&HFFFFFF&,Outline=${outline},Alignment=${alignment},MarginV=${marginV}`

  const save = async () => {
    try {
      const formData = new FormData()
      formData.append('file', new Blob([serializeSrt(cues)], { type: 'application/x-subrip' }), 'edited.srt')
      await api(`/v1/projects/${projectId}/assets?type=document&name=edited.srt`, {
        method: 'POST',
        formData,
      })
      const list = await loadAssets()
      const created = list.find((asset) => asset.name === 'edited.srt')
      if (created) setSelected(created.assetId)
      setMessage('字幕已保存为新资产')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败')
    }
  }

  return (
    <>
      <Nav />
      <main className="page">
        <header className="page-head">
          <div>
            <p className="eyebrow">字幕</p>
            <h1>可视化字幕编辑</h1>
            <p className="muted">编辑时间轴与文本，保存为 SRT 资产；视频渲染时选择该字幕资产。</p>
          </div>
          <div className="row">
            <Link href={`/projects/${projectId}`} className="ghost">
              返回项目
            </Link>
            <button type="button" onClick={() => void save()}>
              保存字幕
            </button>
          </div>
        </header>

        {message && <p className="muted">{message}</p>}

        <section className="panel">
          <div className="row">
            <label>
              字幕资产
              <select value={selected} onChange={(event) => setSelected(event.target.value)}>
                <option value="">选择 SRT</option>
                {subtitles.map((asset) => (
                  <option key={asset.assetId} value={asset.assetId}>
                    {asset.name} · v{asset.latestVersion}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <h2>样式</h2>
          <div className="row">
            <label>
              字号
              <input value={fontSize} onChange={(event) => setFontSize(event.target.value)} />
            </label>
            <label>
              对齐
              <select value={alignment} onChange={(event) => setAlignment(event.target.value)}>
                <option value="2">底部居中</option>
                <option value="8">顶部居中</option>
                <option value="5">中间居中</option>
              </select>
            </label>
            <label>
              边距
              <input value={marginV} onChange={(event) => setMarginV(event.target.value)} />
            </label>
            <label>
              描边
              <input value={outline} onChange={(event) => setOutline(event.target.value)} />
            </label>
          </div>
          <p className="muted">
            视频渲染时把以下样式填入「字幕样式」：<code>{style}</code>
          </p>

          <h2>字幕条目</h2>
          <ul className="list">
            {cues.map((cue, index) => (
              <li key={index} className="list-item">
                <div className="stack" style={{ flex: 1 }}>
                  <div className="row">
                    <input
                      value={clock(cue.startMs)}
                      onChange={(event) =>
                        updateCue(index, { startMs: parseSrtTimeSafe(event.target.value, cue.startMs) })
                      }
                    />
                    <span>→</span>
                    <input
                      value={clock(cue.endMs)}
                      onChange={(event) =>
                        updateCue(index, { endMs: parseSrtTimeSafe(event.target.value, cue.endMs) })
                      }
                    />
                  </div>
                  <textarea
                    value={cue.text}
                    rows={2}
                    onChange={(event) => updateCue(index, { text: event.target.value })}
                  />
                </div>
                <button type="button" className="ghost" onClick={() => removeCue(index)}>
                  删除
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="ghost" onClick={addCue}>
            添加字幕
          </button>
        </section>
      </main>
    </>
  )
}

function parseSrtTimeSafe(value: string, fallback: number): number {
  const match = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/.exec(value.trim())
  if (!match) return fallback
  return (
    Number(match[1]) * 3_600_000 +
    Number(match[2]) * 60_000 +
    Number(match[3]) * 1000 +
    Number(match[4])
  )
}
