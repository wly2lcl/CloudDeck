import { describe, expect, it } from 'vitest'
import { LocalSandbox } from '../src/index'

const sandbox = new LocalSandbox()

describe('LocalSandbox', () => {
  it('执行命令并返回输出与退出码', async () => {
    const result = await sandbox.run(process.execPath, ['-e', 'console.log("ok")'], {
      cwd: process.cwd(),
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('ok')
    expect(result.timedOut).toBe(false)
  })

  it('超时后终止进程', async () => {
    const result = await sandbox.run(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], {
      cwd: process.cwd(),
      timeoutMs: 100,
    })
    expect(result.timedOut).toBe(true)
    expect(result.exitCode).not.toBe(0)
  })

  it('收到取消信号后终止进程', async () => {
    const controller = new AbortController()
    const running = sandbox.run(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], {
      cwd: process.cwd(),
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(), 100)
    const result = await running
    expect(result.aborted).toBe(true)
  })

  it('只向子进程传递白名单与显式提供的环境变量', async () => {
    process.env.CLAWDECK_TEST_LEAK = 'should-not-leak'
    const result = await sandbox.run(
      process.execPath,
      ['-e', 'console.log(process.env.CLAWDECK_TEST_LEAK ?? "none"); console.log(process.env.PASSED)'],
      { cwd: process.cwd(), env: { PASSED: 'yes' } },
    )
    const lines = result.stdout.trim().split('\n')
    expect(lines[0]).toBe('none')
    expect(lines[1]).toBe('yes')
    delete process.env.CLAWDECK_TEST_LEAK
  })

  it('通过 stdin 传递输入', async () => {
    const result = await sandbox.run(
      process.execPath,
      ['-e', 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>console.log(d.toUpperCase()))'],
      { cwd: process.cwd(), stdin: 'hello' },
    )
    expect(result.stdout.trim()).toBe('HELLO')
  })
})

describe('DockerSandbox 参数', () => {
  it('传入 runtime 与网络参数', async () => {
    const { mkdtemp, chmod, writeFile, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = await mkdtemp(join(tmpdir(), 'clouddeck-fake-docker-'))
    const fake = join(dir, 'docker')
    await writeFile(fake, '#!/bin/sh\necho "$@"\n')
    await chmod(fake, 0o755)
    const oldPath = process.env.PATH
    process.env.PATH = `${dir}:${oldPath}`
    try {
      const { DockerSandbox } = await import('../src/index')
      const sandbox = new DockerSandbox({
        image: 'test-image',
        workspaceRoot: dir,
        runtime: 'runsc',
        network: 'none',
      })
      const result = await sandbox.run('echo', ['hello'], { cwd: dir })
      expect(result.stdout).toContain('--runtime runsc')
      expect(result.stdout).toContain('--network none')
      expect(result.stdout).toContain('test-image echo hello')
    } finally {
      process.env.PATH = oldPath
      await rm(dir, { recursive: true, force: true })
    }
  })
})
