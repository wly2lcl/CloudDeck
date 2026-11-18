export interface SubtitleCue {
  index: number
  startMs: number
  endMs: number
  text: string
}

function parseTime(value: string): number {
  const match = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/.exec(value.trim())
  if (!match) throw new Error(`非法时间戳: ${value}`)
  return (
    Number(match[1]) * 3_600_000 +
    Number(match[2]) * 60_000 +
    Number(match[3]) * 1000 +
    Number(match[4])
  )
}

function formatTime(ms: number): string {
  const total = Math.max(0, Math.round(ms))
  const hours = Math.floor(total / 3_600_000)
  const minutes = Math.floor((total % 3_600_000) / 60_000)
  const seconds = Math.floor((total % 60_000) / 1000)
  const millis = total % 1000
  const pad = (value: number, width = 2) => String(value).padStart(width, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`
}

export function parseSrt(content: string): SubtitleCue[] {
  const blocks = content.replace(/\r\n/g, '\n').trim().split(/\n{2,}/)
  const cues: SubtitleCue[] = []
  for (const block of blocks) {
    const lines = block.split('\n')
    if (lines.length < 2) continue
    const timeLine = lines[1]?.includes('-->') ? lines[1] : lines[0]
    if (!timeLine?.includes('-->')) continue
    const [start, end] = timeLine.split('-->').map((part) => part.trim())
    if (!start || !end) continue
    cues.push({
      index: cues.length + 1,
      startMs: parseTime(start),
      endMs: parseTime(end),
      text: lines.slice(lines[1]?.includes('-->') ? 2 : 1).join('\n').trim(),
    })
  }
  return cues
}

export function serializeSrt(cues: SubtitleCue[]): string {
  return cues
    .map((cue, index) =>
      [
        String(index + 1),
        `${formatTime(cue.startMs)} --> ${formatTime(cue.endMs)}`,
        cue.text.trim(),
        '',
      ].join('\n'),
    )
    .join('\n')
}

export { formatTime as formatSrtTime, parseTime as parseSrtTime }
