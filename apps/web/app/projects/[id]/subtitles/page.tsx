'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { formatSrtTime, parseSrt, serializeSrt, type SubtitleCue } from '@clouddeck/contracts'
import { Nav } from '../../../../components/nav'
import { api, getAssetContent, getAssetUrl, type Asset } from '../../../../lib/api'

interface TrackStyle {
  fontSize: string
  alignment: string
  marginV: string
  outline: string
}

interface Track {
  assetId: string
  name: string
  cues: SubtitleCue[]
  visible: boolean
  style: TrackStyle
}

function defaultStyle(index: number): TrackStyle {
  return {
    fontSize: '20',
    alignment: index % 2 === 0 ? '2' : '8',
    marginV: String(24 + index * 32),
    outline: '1',
  }
}

function styleString(style: TrackStyle): string {
  return `FontName=Noto Sans CJK SC,FontSize=${style.fontSize},PrimaryColour=&HFFFFFF&,Outline=${style.outline},Alignment=${style.alignment},MarginV=${style.marginV}`
}

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
  selectedIndex,
  onSeek,
  onBoundary,
  onMove,
}: {
  url: string
  cues: SubtitleCue[]
  selectedIndex: number
  onSeek(ms: number, shift: boolean): void
  onBoundary(index: number, edge: 'start' | 'end', ms: number): void
  onMove(index: number, startMs: number): void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [peaks, setPeaks] = useState<number[]>([])
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const dragRef = useRef<
    { mode: 'start' | 'end' | 'move'; index: number; offset: number } | null
  >(null)

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
      const selected = cues[selectedIndex]
      if (selected) {
        ctx.fillStyle = 'rgba(94, 234, 212, 0.16)'
        ctx.fillRect(
          (selected.startMs / duration) * width,
          0,
          Math.max(1, ((selected.endMs - selected.startMs) / duration) * width),
          height,
        )
      }
      cues.forEach((cue) => {
        ctx.fillStyle = '#f59e0b'
        ctx.fillRect((cue.startMs / duration) * width, 0, 1.5, height)
        ctx.fillStyle = '#38bdf8'
        ctx.fillRect((cue.endMs / duration) * width, 0, 1.5, height)
      })
    }
  }, [peaks, cues, duration, selectedIndex])

  const snap = (ms: number, excludeIndex: number): number => {
    const candidates: number[] = [0, Math.round(ms / 10) * 10]
    cues.forEach((cue, index) => {
      if (index === excludeIndex) return
      candidates.push(cue.startMs, cue.endMs)
    })
    let best = Math.round(ms / 10) * 10
    let bestDistance = Number.POSITIVE_INFINITY
    for (const candidate of candidates) {
      const distance = Math.abs(candidate - ms)
      if (distance <= 120 && distance < bestDistance) {
        best = candidate
        bestDistance = distance
      }
    }
    return Math.max(0, Math.round(best))
  }

  const cueAt = (ms: number): { index: number; offset: number } | null => {
    const index = cues.findIndex((cue) => ms >= cue.startMs && ms <= cue.endMs)
    if (index < 0) return null
    return { index, offset: ms - (cues[index]?.startMs ?? 0) }
  }

  const nearestBoundary = (ms: number): { index: number; edge: 'start' | 'end' } | null => {
    if (duration <= 0) return null
    const canvas = canvasRef.current
    if (!canvas) return null
    const width = canvas.clientWidth
    const threshold = 10
    let best: { index: number; edge: 'start' | 'end'; distance: number } | null = null
    cues.forEach((cue, index) => {
      for (const edge of ['start', 'end'] as const) {
        const value = edge === 'start' ? cue.startMs : cue.endMs
        const distance = Math.abs((value / duration) * width - (ms / duration) * width)
        if (distance <= threshold && (!best || distance < best.distance)) {
          best = { index, edge, distance }
        }
      }
    })
    return best ? { index: (best as { index: number }).index, edge: (best as { edge: 'start' | 'end' }).edge } : null
  }

  if (error) return <p className="muted">波形不可用：{error}</p>
  return (
    <div>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: 96, display: 'block', cursor: 'ew-resize', touchAction: 'none' }}
        onPointerDown={(event) => {
          if (duration <= 0) return
          const rect = event.currentTarget.getBoundingClientRect()
          const ms = Math.round(((event.clientX - rect.left) / rect.width) * duration)
          const boundary = nearestBoundary(ms)
          if (boundary) {
            dragRef.current = { mode: boundary.edge, index: boundary.index, offset: 0 }
            event.currentTarget.setPointerCapture(event.pointerId)
            return
          }
          const inside = cueAt(ms)
          if (inside) {
            dragRef.current = { mode: 'move', index: inside.index, offset: inside.offset }
            event.currentTarget.setPointerCapture(event.pointerId)
            return
          }
          onSeek(ms, event.shiftKey)
        }}
        onPointerMove={(event) => {
          if (!dragRef.current || duration <= 0) return
          const rect = event.currentTarget.getBoundingClientRect()
          const ms = Math.round(((event.clientX - rect.left) / rect.width) * duration)
          const drag = dragRef.current
          if (drag.mode === 'move') {
            onMove(drag.index, snap(ms - drag.offset, drag.index))
          } else {
            onBoundary(drag.index, drag.mode, snap(ms, drag.index))
          }
        }}
        onPointerUp={() => {
          dragRef.current = null
        }}
        onPointerCancel={() => {
          dragRef.current = null
        }}
      />
      <p className="muted">拖拽橙色/蓝色边界调整起止，拖拽字幕中段整体移动；邻近边界自动吸附，点击空白处定位。</p>
    </div>
  )
}

export default function SubtitleEditorPage() {
  const params = useParams<{ id: string }>()
  const projectId = params.id
  const [assets, setAssets] = useState<Asset[]>([])
  const [tracks, setTracks] = useState<Track[]>([])
  const [activeTrack, setActiveTrack] = useState(0)
  const [selectedCue, setSelectedCue] = useState(0)
  const [mediaId, setMediaId] = useState('')
  const [currentMs, setCurrentMs] = useState(0)
  const [mediaUrl, setMediaUrl] = useState('')
  const [audioUrl, setAudioUrl] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null)

  const mediaAssets = [
    ...assets.filter((asset) => asset.mime.startsWith('video/')),
    ...assets.filter((asset) => asset.mime.startsWith('audio/')),
  ]
  const selectedMedia = assets.find((asset) => asset.assetId === mediaId)
  const isVideo = selectedMedia?.mime.startsWith('video/') ?? false
  const cues = tracks[activeTrack]?.cues ?? []

  const updateCues = (updater: (items: SubtitleCue[]) => SubtitleCue[]) => {
    setTracks((items) =>
      items.map((track, index) =>
        index === activeTrack ? { ...track, cues: updater(track.cues) } : track,
      ),
    )
  }

  const loadAssets = async () => {
    const list = await api<Asset[]>(`/v1/projects/${projectId}/assets`)
    setAssets(list)
    return list
  }

  useEffect(() => {
    void (async () => {
      try {
        const list = await loadAssets()
        const srtAssets = list.filter(
          (asset) => asset.mime === 'application/x-subrip' || asset.name.endsWith('.srt'),
        )
        const loaded = await Promise.all(
          srtAssets.slice(0, 5).map(async (asset, index) => ({
            assetId: asset.assetId,
            name: asset.name,
            visible: true,
            style: defaultStyle(index),
            cues: parseSrt((await getAssetContent(asset.assetId, asset.latestVersion)).text),
          })),
        )
        setTracks(
          loaded.length > 0
            ? loaded
            : [{ assetId: '', name: '字幕轨道 1', cues: [], visible: true, style: defaultStyle(0) }],
        )
        const firstMedia =
          list.find((asset) => asset.mime.startsWith('video/')) ??
          list.find((asset) => asset.mime.startsWith('audio/'))
        if (firstMedia) setMediaId(firstMedia.assetId)
      } catch (error) {
        setMessage(error instanceof Error ? error.message : '加载失败')
      }
    })()
  }, [projectId])

  useEffect(() => {
    const asset = assets.find((item) => item.assetId === mediaId)
    if (!asset) return
    void getAssetUrl(asset.assetId, asset.latestVersion)
      .then(({ url }) => {
        setMediaUrl(url)
        const audio = assets.find((item) => item.mime.startsWith('audio/'))
        if (audio && audio.assetId !== asset.assetId) {
          void getAssetUrl(audio.assetId, audio.latestVersion).then((result) => setAudioUrl(result.url))
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
    updateCues((items) => items.map((cue, i) => (i === index ? { ...cue, ...patch } : cue)))
  }

  const align = (ms: number, shift: boolean) => {
    const index = Math.min(selectedCue, cues.length - 1)
    const cue = cues[index]
    if (!cue) return
    if (shift) updateCue(index, { endMs: Math.max(cue.startMs + 100, ms) })
    else updateCue(index, { startMs: Math.min(cue.endMs - 100, ms) })
    seek(ms)
  }

  const dragBoundary = (index: number, edge: 'start' | 'end', ms: number) => {
    const cue = cues[index]
    if (!cue) return
    if (edge === 'start') updateCue(index, { startMs: Math.min(cue.endMs - 100, Math.max(0, ms)) })
    else updateCue(index, { endMs: Math.max(cue.startMs + 100, ms) })
  }

  const moveCue = (index: number, startMs: number) => {
    const cue = cues[index]
    if (!cue) return
    const duration = cue.endMs - cue.startMs
    const start = Math.max(0, Math.min(startMs, Number.MAX_SAFE_INTEGER))
    updateCue(index, { startMs: start, endMs: start + duration })
  }

  const addCue = () => {
    const last = cues[cues.length - 1]
    const start = last?.endMs ?? currentMs
    updateCues((items) => [
      ...items,
      { index: items.length + 1, startMs: start, endMs: start + 2000, text: '新字幕' },
    ])
    setSelectedCue(cues.length)
  }

  const removeCue = (index: number) => {
    updateCues((items) => items.filter((_, i) => i !== index).map((cue, i) => ({ ...cue, index: i + 1 })))
    setSelectedCue(0)
  }

  const addTrack = () => {
    setTracks((items) => [
      ...items,
      {
        assetId: '',
        name: `字幕轨道 ${items.length + 1}`,
        cues: [],
        visible: true,
        style: defaultStyle(items.length),
      },
    ])
    setActiveTrack(tracks.length)
  }

  const saveTrack = async (track: Track, index: number, name?: string) => {
    const formData = new FormData()
    const filename = name ?? (track.assetId ? `${track.name}-edited.srt` : `track-${index + 1}.srt`)
    formData.append('file', new Blob([serializeSrt(track.cues)], { type: 'application/x-subrip' }), filename)
    await api(`/v1/projects/${projectId}/assets?type=document&name=${encodeURIComponent(filename)}`, {
      method: 'POST',
      formData,
    })
    return filename
  }

  const save = async () => {
    try {
      const track = tracks[activeTrack]
      if (!track) return
      const filename = await saveTrack(track, activeTrack)
      setTracks((items) =>
        items.map((item, index) => (index === activeTrack ? { ...item, name: filename } : item)),
      )
      await loadAssets()
      setMessage('字幕轨道已保存为新资产')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败')
    }
  }

  const mergeTracks = async () => {
    try {
      const merged = tracks
        .filter((track) => track.visible)
        .flatMap((track) => track.cues)
        .sort((a, b) => a.startMs - b.startMs)
        .map((cue, index) => ({ ...cue, index: index + 1 }))
      const formData = new FormData()
      formData.append('file', new Blob([serializeSrt(merged)], { type: 'application/x-subrip' }), 'merged.srt')
      await api(`/v1/projects/${projectId}/assets?type=document&name=merged.srt`, {
        method: 'POST',
        formData,
      })
      await loadAssets()
      setMessage('可见轨道已合并为 merged.srt')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '合并失败')
    }
  }

  const activeStyle = tracks[activeTrack]?.style ?? defaultStyle(0)
  const subtitleStyles = tracks.map((track) => styleString(track.style))
  const updateStyle = (patch: Partial<TrackStyle>) => {
    setTracks((items) =>
      items.map((track, index) =>
        index === activeTrack ? { ...track, style: { ...track.style, ...patch } } : track,
      ),
    )
  }

  return (
    <>
      <Nav />
      <main className="page">
        <header className="page-head">
          <div>
            <p className="eyebrow">字幕</p>
            <h1>多轨字幕编辑</h1>
            <p className="muted">拖拽波形边界、叠加预览多条轨道，保存或合并为 SRT 资产。</p>
          </div>
          <div className="row">
            <Link href={`/projects/${projectId}`} className="ghost">
              返回项目
            </Link>
            <button type="button" className="ghost" onClick={addTrack}>
              添加轨道
            </button>
            <button type="button" className="ghost" onClick={() => void mergeTracks()}>
              合并可见轨道
            </button>
            <button type="button" onClick={() => void save()}>
              保存当前轨道
            </button>
          </div>
        </header>

        {message && <p className="muted">{message}</p>}

        <section className="panel">
          <h2>轨道</h2>
          <div className="row">
            {tracks.map((track, index) => (
              <button
                key={index}
                type="button"
                className={index === activeTrack ? '' : 'ghost'}
                onClick={() => {
                  setActiveTrack(index)
                  setSelectedCue(0)
                }}
              >
                {track.name}
                {track.assetId ? '' : ' *'}
              </button>
            ))}
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            {tracks.map((track, index) => (
              <label key={index}>
                <input
                  type="checkbox"
                  checked={track.visible}
                  onChange={(event) =>
                    setTracks((items) =>
                      items.map((item, i) => (i === index ? { ...item, visible: event.target.checked } : item)),
                    )
                  }
                />
                显示 {track.name}
              </label>
            ))}
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

          {audioUrl && <Waveform
            url={audioUrl}
            cues={cues}
            selectedIndex={selectedCue}
            onSeek={align}
            onBoundary={dragBoundary}
            onMove={moveCue}
          />}

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
              {tracks.map((track, index) => {
                const cue = track.visible
                  ? track.cues.find((item) => currentMs >= item.startMs && currentMs <= item.endMs)
                  : undefined
                if (!cue) return null
                return (
                  <div
                    key={index}
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      [track.style.alignment === '8' ? 'top' : 'bottom']: `${track.style.marginV}px`,
                      textAlign: 'center',
                      fontSize: `${track.style.fontSize}px`,
                      color: '#fff',
                      textShadow: `0 0 ${track.style.outline}px #000, 0 0 ${track.style.outline}px #000`,
                      pointerEvents: 'none',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {cue.text}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <section className="panel">
          <h2>样式</h2>
          <div className="row">
            <label>
              字号
              <input
                value={activeStyle.fontSize}
                onChange={(event) => updateStyle({ fontSize: event.target.value })}
              />
            </label>
            <label>
              对齐
              <select
                value={activeStyle.alignment}
                onChange={(event) => updateStyle({ alignment: event.target.value })}
              >
                <option value="2">底部居中</option>
                <option value="8">顶部居中</option>
                <option value="5">中间居中</option>
              </select>
            </label>
            <label>
              边距
              <input
                value={activeStyle.marginV}
                onChange={(event) => updateStyle({ marginV: event.target.value })}
              />
            </label>
            <label>
              描边
              <input
                value={activeStyle.outline}
                onChange={(event) => updateStyle({ outline: event.target.value })}
              />
            </label>
          </div>
          <p className="muted">
            当前轨道样式：<code>{styleString(activeStyle)}</code>
          </p>
          <p className="muted">
            多轨样式 JSON（填入视频任务 `subtitleStyles`）：
            <code>{JSON.stringify(subtitleStyles)}</code>
          </p>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              void navigator.clipboard?.writeText(JSON.stringify(subtitleStyles))
            }}
          >
            复制多轨样式 JSON
          </button>
        </section>

        <section className="panel">
          <h2>字幕条目 · {tracks[activeTrack]?.name}</h2>
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
