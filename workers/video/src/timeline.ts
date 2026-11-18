export interface StoryboardShot {
  index: number
  scene?: string
  description: string
  shotSize?: string
  camera?: string
  durationMs: number
}

export interface StoryboardData {
  title?: string
  shots: StoryboardShot[]
}

export interface TimelineItem {
  index: number
  startMs: number
  endMs: number
  durationMs: number
  shot: StoryboardShot
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

export function parseStoryboard(text: string): StoryboardData {
  const parsed = JSON.parse(text) as Partial<StoryboardData>
  if (!Array.isArray(parsed.shots) || parsed.shots.length === 0) {
    throw new Error('分镜缺少 shots')
  }

  return {
    title: parsed.title,
    shots: parsed.shots.map((shot, index) => ({
      index: index + 1,
      scene: shot.scene,
      description: String(shot.description ?? shot.scene ?? `镜头 ${index + 1}`),
      shotSize: shot.shotSize,
      camera: shot.camera,
      durationMs: clamp(Number(shot.durationMs ?? 3000), 200, 30_000),
    })),
  }
}

export function buildTimeline(shots: StoryboardShot[]): TimelineItem[] {
  let cursor = 0
  return shots.map((shot) => {
    const startMs = cursor
    cursor += shot.durationMs
    return {
      index: shot.index,
      startMs,
      endMs: cursor,
      durationMs: shot.durationMs,
      shot,
    }
  })
}

export function formatSrtTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const millis = Math.floor(ms % 1000)
  const pad = (value: number, width = 2) => String(value).padStart(width, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`
}

export function toSrt(items: TimelineItem[]): string {
  return items
    .map((item, index) => {
      const description = `${item.shot.description}（${item.shot.shotSize ?? '中景'}）`
      return [
        String(index + 1),
        `${formatSrtTime(item.startMs)} --> ${formatSrtTime(item.endMs)}`,
        description,
        '',
      ].join('\n')
    })
    .join('\n')
}

export function totalDurationMs(items: TimelineItem[]): number {
  return items.length === 0 ? 0 : (items[items.length - 1] as TimelineItem).endMs
}

/** 镜头首尾淡入淡出，作为确定性的基础转场。 */
export function fadeFilter(durationMs: number): string {
  const duration = Math.max(0.1, durationMs / 1000)
  const fade = Math.min(0.3, duration / 4)
  return `fade=t=in:st=0:d=${fade.toFixed(3)},fade=t=out:st=${(duration - fade).toFixed(3)}:d=${fade.toFixed(3)}`
}

export interface XfadePlan {
  filter: string
  outputLabel: string
  durationMs: number
  transitionMs: number
}

/** 生成 xfade 链式滤镜；输入为各镜头时长（毫秒）。 */
export function buildXfadeFilter(
  durationsMs: number[],
  transitionMs = 500,
  transition = 'fade',
): XfadePlan {
  if (durationsMs.length < 2) throw new Error('xfade 至少需要两个镜头')
  const shortest = Math.min(...durationsMs)
  const duration = Math.max(100, Math.min(transitionMs, Math.floor(shortest / 4)))
  const parts: string[] = []
  let previous = '[0:v]'
  let cumulative = durationsMs[0] as number
  for (let index = 1; index < durationsMs.length; index += 1) {
    const outputLabel = `[v${index}]`
    const offset = Math.max(0, cumulative - duration * index) / 1000
    parts.push(
      `${previous}[${index}:v]xfade=transition=${transition}:duration=${(duration / 1000).toFixed(3)}:offset=${offset.toFixed(3)}${outputLabel}`,
    )
    previous = outputLabel
    cumulative += durationsMs[index] as number
  }
  return {
    filter: parts.join(';'),
    outputLabel: previous,
    durationMs: cumulative - duration * (durationsMs.length - 1),
    transitionMs: duration,
  }
}


/** 生成字幕烧录滤镜，force_style 控制字体、字号、位置与描边。 */
export function subtitleBurnFilter(style: string): string {
  return `subtitles=subtitles.srt:force_style='${style.replace(/'/g, "")}'`
}
