import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProviderFromEnv } from '../src/providers'
import { parseWav, wavDurationMs } from '../src/wav'

async function main(): Promise<void> {
  const provider = createProviderFromEnv(process.env)
  console.log(`provider=${provider.name} model=${process.env.TTS_MODEL ?? 'default'}`)

  const started = Date.now()
  const audio = await provider.synthesize({
    text: '你好，这是 CloudDeck 的真实语音合成测试。',
    voice: process.env.TTS_DEFAULT_VOICE ?? 'longanhuan_v3.1',
    format: 'wav',
  })
  const info = parseWav(audio)
  const path = join(tmpdir(), 'clouddeck-tts-smoke.wav')
  await writeFile(path, audio)

  console.log(
    `ok in ${Date.now() - started}ms bytes=${audio.length} rate=${info.sampleRate} duration=${Math.round(wavDurationMs(audio))}ms`,
  )
  console.log(`saved=${path}`)
}

main().catch((error) => {
  console.error('TTS smoke 失败', error)
  process.exit(1)
})
