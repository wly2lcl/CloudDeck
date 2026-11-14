export interface WavInfo {
  sampleRate: number
  channels: number
  bitsPerSample: number
  data: Buffer
}

function readChunks(buffer: Buffer): { id: string; body: Buffer }[] {
  const chunks: { id: string; body: Buffer }[] = []
  let offset = 12
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const start = offset + 8
    const end = Math.min(start + size, buffer.length)
    chunks.push({ id, body: buffer.subarray(start, end) })
    offset = start + size + (size % 2)
  }
  return chunks
}

export function parseWav(buffer: Buffer): WavInfo {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error('不是合法的 WAV 文件')
  }
  if (buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('WAV 格式缺失 WAVE 标记')
  }

  let sampleRate = 0
  let channels = 0
  let bitsPerSample = 0
  let data: Buffer | null = null

  for (const chunk of readChunks(buffer)) {
    if (chunk.id === 'fmt ') {
      channels = chunk.body.readUInt16LE(2)
      sampleRate = chunk.body.readUInt32LE(4)
      bitsPerSample = chunk.body.readUInt16LE(14)
    }
    if (chunk.id === 'data') data = chunk.body
  }

  if (!data || !sampleRate || !channels || !bitsPerSample) {
    throw new Error('WAV 缺少 fmt 或 data 块')
  }

  return { sampleRate, channels, bitsPerSample, data }
}

export function wavDurationMs(buffer: Buffer): number {
  const info = parseWav(buffer)
  const bytesPerFrame = (info.bitsPerSample / 8) * info.channels
  return (info.data.length / (info.sampleRate * bytesPerFrame)) * 1000
}

export function createToneWav(
  durationMs: number,
  sampleRate = 16000,
  frequency = 440,
): Buffer {
  const samples = Math.max(1, Math.round((sampleRate * durationMs) / 1000))
  const dataSize = samples * 2
  const buffer = Buffer.alloc(44 + dataSize)

  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataSize, 40)

  const fade = Math.min(samples / 4, sampleRate * 0.01)
  for (let i = 0; i < samples; i += 1) {
    const envelope =
      i < fade ? i / fade : i > samples - fade ? (samples - i) / fade : 1
    const value = Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 0.2 * envelope
    buffer.writeInt16LE(Math.round(value * 32767), 44 + i * 2)
  }

  return buffer
}

export function concatWav(buffers: Buffer[]): Buffer {
  if (buffers.length === 0) throw new Error('没有可拼接的 WAV')

  const infos = buffers.map(parseWav)
  const first = infos[0] as WavInfo
  for (const info of infos) {
    if (
      info.sampleRate !== first.sampleRate ||
      info.channels !== first.channels ||
      info.bitsPerSample !== first.bitsPerSample
    ) {
      throw new Error('WAV 格式不一致，无法直接拼接')
    }
  }

  const total = infos.reduce((sum, info) => sum + info.data.length, 0)
  const output = Buffer.alloc(44 + total)
  output.write('RIFF', 0, 'ascii')
  output.writeUInt32LE(36 + total, 4)
  output.write('WAVE', 8, 'ascii')
  output.write('fmt ', 12, 'ascii')
  output.writeUInt32LE(16, 16)
  output.writeUInt16LE(1, 20)
  output.writeUInt16LE(first.channels, 22)
  output.writeUInt32LE(first.sampleRate, 24)
  output.writeUInt32LE((first.sampleRate * first.channels * first.bitsPerSample) / 8, 28)
  output.writeUInt16LE((first.channels * first.bitsPerSample) / 8, 32)
  output.writeUInt16LE(first.bitsPerSample, 34)
  output.write('data', 36, 'ascii')
  output.writeUInt32LE(total, 40)

  let offset = 44
  for (const info of infos) {
    info.data.copy(output, offset)
    offset += info.data.length
  }
  return output
}
