'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { formatSrtTime, parseSrt, serializeSrt, type SubtitleCue } from '@clouddeck/contracts'
import { Nav } from '../../../../components/nav'
import { api, getAssetContent, getAssetUrl, type Asset } from '../../../../lib/api'

function parseClock(value: string, fallback: number): number {
  const match = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/.exec(value.trim())
  if (!match) return fallback
  return (
    Number(match[1]) * 3_600_000 +
    Number(match[2]) * 60_000 +
    Number(match[3]) * 1000 +
    Number(match[4])
  )
}

function Waveform({
  url,
  cues,
  onSeek,
}: {
  url: string
  cues: SubtitleCue[]
  onSeek(ms: number, shift: boolean): void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [peaks, setPeaks] = useState<number[]>([])
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch(url)
        if (!response.ok) throw new Error(`音频加载失败 ${response.status}`)
        const buffer = await response.arrayBuffer()
        const context = new AudioContext()
        const audio = await context.decodeAudioData(buffer)
        await context.close()
        const channel = audio.getChannelData(0)
        const buckets = 600
        const step = Math.max(1, Math.floor(channel.length / buckets))
        const next: number[] = []
        for (let i = 0; i < buckets; i += 1) {
          let peak = 0
          for (let j = 0; j < step; j += 1) peak = Math.max(peak, Math.abs(channel[i * step + j] ?? 0))
          next.push(peak)
        }
        if (!cancelled) {
          setPeaks(next)
          setDuration(audio.duration * 1000)
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : '波形加载失败')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [url])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ratio = window.devicePixelRatio || 1
    const width = canvas.clientWidth
    const height = 96
    canvas.width = width * ratio
    canvas.height = height * ratio
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(ratio, ratio)
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = '#1e2937'
    ctx.fillRect(0, 0, width, height)
    if (peaks.length > 0) {
      ctx.fillStyle = '#5eead4'
      const barWidth = width / peaks.length
      peaks.forEach((peak, index) => {
        const h = Math.max(2, peak * height * 0.9)
        ctx.fillRect(index * barWidth, (height - h) / 2, Math.max(1, barWidth - 1), h)
      })
    }
    if (duration > 0) {
      ctx.fillStyle = '#f59e0b'
      for (const cue of cues) {
        for (const ms of [cue.startMs, cue.endMs]) {
          const x = (ms / duration) * width
          ctx.fillRect(x, 0, 1, height)
        }
      }
    }
  }, [peaks, cues, duration])

  if (error) return <p className="muted">波形不可用：{error}</p>
  return (
    <div>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: 96, display: 'block', cursor: 'crosshair' }}
        onClick={(event) => {
          if (duration <= 0) return
          const rect = event.currentTarget.getBoundingClientRect()
          const ratio = (event.clientX - rect.left) / rect.width
          onSeek(Math.round(ratio * duration), event.shiftKey)
        }}
      />
      <p className="muted">点击波形设置选中字幕起点，Shift+点击设置终点；时间条可拖动播放。</p>
    </div>
  )
}

export default function SubtitleEditorPage() {
  const params = useParams<{ id: string }>()
  const projectId = params.id
  const [assets, setAssets] = useState<Asset[]>([])
  const [subtitleId, setSubtitleId] = useState('')
  const [mediaId, setMediaId] = useState('')
  const [cues, setCues] = useState<SubtitleCue[]>([])
  const [selectedCue, setSelectedCue] = useState(0)
  const [currentMs, setCurrentMs] = useState(0)
  const [mediaUrl, setMediaUrl] = useState('')
  const [audioUrl, setAudioUrl] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [fontSize, setFontSize] = useState('20')
  const [alignment, setAlignment] = useState('2')
  const [marginV, setMarginV] = useState('24')
  const [outline, setOutline] = useState('1')
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null)

  const subtitles = assets.filter(
    (asset) => asset.mime === 'application/x-subrip' || asset.name.endsWith('.srt'),
  )
  const audioAssets = assets.filter((asset) => asset.mime.startsWith('audio/'))
  const videoAssets = assets.filter((asset) => asset.mime.startsWith('video/'))
  const mediaAssets = [...videoAssets, ...audioAssets]
  const selectedMedia = assets.find((asset) => asset.assetId === mediaId)
  const isVideo = selectedMedia?.mime.startsWith('video/') ?? false

  const loadAssets = async () => {
    const list = await api<Asset[]>(`/v1/projects/${projectId}/assets`)
    setAssets(list)
    return list
  }

  useEffect(() => {
    void loadAssets()
      .then((list) => {
        const firstSubtitle = list.find(
          (asset) => asset.mime === 'application/x-subrip' || asset.name.endsWith('.srt'),
        )
        if (firstSubtitle) setSubtitleId(firstSubtitle.assetId)
        const firstMedia =
          list.find((asset) => asset.mime.startsWith('video/')) ??
          list.find((asset) => asset.mime.startsWith('audio/'))
        if (firstMedia) setMediaId(firstMedia.assetId)
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : '加载失败'))
  }, [projectId])

  useEffect(() => {
    const asset = assets.find((item) => item.assetId === subtitleId)
    if (!asset) return
    void getAssetContent(asset.assetId, asset.latestVersion)
      .then((content) => setCues(parseSrt(content.text)))
      .catch((error) => setMessage(error instanceof Error ? error.message : '字幕解析失败'))
  }, [subtitleId, assets])

  useEffect(() => {
    const asset = assets.find((item) => item.assetId === mediaId)
    if (!asset) return
    void getAssetUrl(asset.assetId, asset.latestVersion)
      .then(({ url }) => {
        setMediaUrl(url)
        const audio = audioAssets.find((item) => item.mime.startsWith('audio/'))
        if (audio && audio.assetId !== asset.assetId) {
          void getAssetUrl(audio.assetId, audio.latestVersion).then((result) =>
            setAudioUrl(result.url),
          )
        } else {
          setAudioUrl(asset.mime.startsWith('audio/') ? url : '')
        }
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : '媒体加载失败'))
  }, [mediaId, assets])

  const seek = (ms: number) => {
    setCurrentMs(ms)
    if (mediaRef.current) mediaRef.current.currentTime = ms / 1000
  }

  const updateCue = (index: number, patch: Partial<SubtitleCue>) => {
    setCues((items) => items.map((cue, i) => (i === index ? { ...cue, ...patch } : cue)))
  }

  const align = (ms: number, shift: boolean) => {
    const index = Math.min(selectedCue, cues.length - 1)
    if (index < 0 || cues.length === 0) return
    const cue = cues[index]
    if (!cue) return
    if (shift) {
      updateCue(index, { endMs: Math.max(cue.startMs + 100, ms) })
    } else {
      updateCue(index, { startMs: Math.min(cue.endMs - 100, ms) })
    }
    seek(ms)
  }

  const addCue = () => {
    const last = cues[cues.length - 1]
    const start = last?.endMs ?? currentMs
    setCues([...cues, { index: cues.length + 1, startMs: start, endMs: start + 2000, text: '新字幕' }])
    setSelectedCue(cues.length)
  }

  const removeCue = (index: number) => {
    setCues(cues.filter((_, i) => i !== index).map((cue, i) => ({ ...cue, index: i + 1 })))
    setSelectedCue(0)
  }

  const style = `FontName=Noto Sans CJK SC,FontSize=${fontSize},PrimaryColour=&HFFFFFF&,Outline=${outline},Alignment=${alignment},MarginV=${marginV}`
  const active = cues.find((cue) => currentMs >= cue.startMs && currentMs <= cue.endMs)

  const save = async () => {
    try {
      const formData = new FormData()
      formData.append(
        'file',
        new Blob([serializeSrt(cues)], { type: 'application/x-subrip' }),
        'edited.srt',
      )
      await api(`/v1/projects/${projectId}/assets?type=document&name=edited.srt`, {
        method: 'POST',
        formData,
      })
      const list = await loadAssets()
      const created = list.find((asset) => asset.name === 'edited.srt')
      if (created) setSubtitleId(created.assetId)
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
            <p className="muted">波形对齐、时间轴与实时预览；保存为 SRT 资产供视频渲染使用。</p>
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
              <select value={subtitleId} onChange={(event) => setSubtitleId(event.target.value)}>
                <option value="">选择 SRT</option>
                {subtitles.map((asset) => (
                  <option key={asset.assetId} value={asset.assetId}>
                    {asset.name} · v{asset.latestVersion}
                  </option>
                ))}
              </select>
            </label>
            <label>
              预览媒体
              <select value={mediaId} onChange={(event) => setMediaId(event.target.value)}>
                <option value="">选择视频/音频</option>
                {mediaAssets.map((asset) => (
                  <option key={asset.assetId} value={asset.assetId}>
                    {asset.name} · {asset.mime}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {audioUrl && <Waveform url={audioUrl} cues={cues} onSeek={align} />}

          {mediaUrl && (
            <div style={{ position: 'relative', marginTop: 12, background: '#000' }}>
              {isVideo ? (
                <video
                  ref={mediaRef as React.RefObject<HTMLVideoElement>}
                  src={mediaUrl}
                  controls
                  style={{ width: '100%', maxHeight: 360 }}
                  onTimeUpdate={(event) => setCurrentMs(event.currentTarget.currentTime * 1000)}
                />
              ) : (
                <audio
                  ref={mediaRef as React.RefObject<HTMLAudioElement>}
                  src={mediaUrl}
                  controls
                  style={{ width: '100%' }}
                  onTimeUpdate={(event) => setCurrentMs(event.currentTarget.currentTime * 1000)}
                />
              )}
              {active && (
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    [alignment === '8' ? 'top' : alignment === '5' ? 'top' : 'bottom']:
                      alignment === '5' ? '40%' : `${marginV}px`,
                    textAlign: 'center',
                    fontSize: `${fontSize}px`,
                    color: '#fff',
                    textShadow: `0 0 ${outline}px #000, 0 0 ${outline}px #000`,
                    pointerEvents: 'none',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {active.text}
                </div>
              )}
            </div>
          )}
        </section>

        <section className="panel">
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
            视频渲染样式：<code>{style}</code>
          </p>
        </section>

        <section className="panel">
          <h2>字幕条目</h2>
          <ul className="list">
            {cues.map((cue, index) => (
              <li
                key={index}
                className="list-item"
                style={{ outline: index === selectedCue ? '1px solid #5eead4' : 'none' }}
                onClick={() => {
                  setSelectedCue(index)
                  seek(cue.startMs)
                }}
              >
                <div className="stack" style={{ flex: 1 }}>
                  <div className="row">
                    <input
                      value={formatSrtTime(cue.startMs)}
                      onChange={(event) =>
                        updateCue(index, { startMs: parseClock(event.target.value, cue.startMs) })
                      }
                    />
                    <span>→</span>
                    <input
                      value={formatSrtTime(cue.endMs)}
                      onChange={(event) =>
                        updateCue(index, { endMs: parseClock(event.target.value, cue.endMs) })
                      }
                    />
                    <button type="button" className="ghost" onClick={() => seek(cue.startMs)}>
                      定位
                    </button>
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
          <div className="row">
            <button type="button" className="ghost" onClick={addCue}>
              添加字幕
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                const cue = cues[selectedCue]
                if (cue) updateCue(selectedCue, { startMs: currentMs })
              }}
            >
              当前时间设为起点
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                const cue = cues[selectedCue]
                if (cue) updateCue(selectedCue, { endMs: Math.max(cue.startMs + 100, currentMs) })
              }}
            >
              当前时间设为终点
            </button>
          </div>
        </section>
      </main>
    </>
  )
}
