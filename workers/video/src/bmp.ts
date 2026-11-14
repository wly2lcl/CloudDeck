export type Pixel = [number, number, number]

const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)))

export function createBmp(
  width: number,
  height: number,
  pixel: (x: number, y: number) => Pixel,
): Buffer {
  const rowSize = Math.floor((24 * width + 31) / 32) * 4
  const dataSize = rowSize * height
  const buffer = Buffer.alloc(54 + dataSize)

  buffer.write('BM', 0, 'ascii')
  buffer.writeUInt32LE(54 + dataSize, 2)
  buffer.writeUInt32LE(54, 10)
  buffer.writeUInt32LE(40, 14)
  buffer.writeInt32LE(width, 18)
  buffer.writeInt32LE(height, 22)
  buffer.writeUInt16LE(1, 26)
  buffer.writeUInt16LE(24, 28)
  buffer.writeUInt32LE(dataSize, 34)

  for (let y = 0; y < height; y += 1) {
    const row = height - 1 - y
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, y)
      const offset = 54 + row * rowSize + x * 3
      buffer[offset] = clamp(b)
      buffer[offset + 1] = clamp(g)
      buffer[offset + 2] = clamp(r)
    }
  }

  return buffer
}

const PALETTE: Pixel[] = [
  [18, 30, 46],
  [34, 52, 74],
  [52, 74, 98],
  [74, 96, 122],
  [96, 120, 148],
  [122, 146, 176],
]

export function createShotFrame(
  index: number,
  width = 640,
  height = 360,
): Buffer {
  const base = PALETTE[index % PALETTE.length] as Pixel
  const centerX = width * (0.3 + ((index * 13) % 40) / 100)
  const centerY = height * 0.5
  const radius = Math.min(width, height) * 0.22

  return createBmp(width, height, (x, y) => {
    const gradient = y / height
    const distance = Math.hypot(x - centerX, y - centerY)
    const glow = distance < radius ? (1 - distance / radius) * 60 : 0
    return [
      base[0] + gradient * 40 + glow,
      base[1] + gradient * 30 + glow * 0.9,
      base[2] + gradient * 20 + glow * 0.8,
    ]
  })
}
