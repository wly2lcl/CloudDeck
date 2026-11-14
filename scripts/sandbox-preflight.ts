import { execFileSync } from 'node:child_process'

function run(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function main(): void {
  try {
    const version = run('docker', ['info', '--format', '{{.ServerVersion}}']).trim()
    console.log(`docker server=${version}`)
  } catch (error) {
    console.error('Docker 不可用，无法检查沙箱运行时', error)
    process.exit(1)
  }

  const runtime = process.env.SANDBOX_RUNTIME ?? ''
  if (!runtime) {
    console.log('SANDBOX_RUNTIME 未设置，使用 Docker 默认运行时（runc）。')
    console.log('需要 gVisor 时：安装 runsc 并设置 SANDBOX_RUNTIME=runsc。')
    return
  }

  try {
    const raw = run('docker', ['info', '--format', '{{json .Runtimes}}'])
    const runtimes = JSON.parse(raw) as Record<string, unknown>
    if (runtimes[runtime]) {
      console.log(`运行时 ${runtime} 已注册。`)
      console.log(`预检通过：SANDBOX_DRIVER=docker SANDBOX_RUNTIME=${runtime}`)
    } else {
      console.error(`运行时 ${runtime} 未注册。已注册：${Object.keys(runtimes).join(', ')}`)
      process.exit(1)
    }
  } catch (error) {
    console.error('读取 Docker 运行时列表失败', error)
    process.exit(1)
  }
}

main()
