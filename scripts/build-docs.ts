import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep as pathSeparator } from 'node:path'
import { fileURLToPath } from 'node:url'
import { marked } from 'marked'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DOCS = join(ROOT, 'docs')
const OUT = join(ROOT, 'site')

const PAGE = (title: string, body: string, prefix = '') => `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} · CloudDeck</title>
  <style>
    :root { color-scheme: dark; --bg:#0b0f14; --panel:#121821; --border:#1e2937; --text:#e6edf5; --muted:#8b9bb0; --accent:#5eead4; }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--bg); color:var(--text); font:15px/1.7 ui-sans-serif,system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif; }
    header { position:sticky; top:0; display:flex; justify-content:space-between; align-items:center; padding:14px 24px; border-bottom:1px solid var(--border); background:rgba(11,15,20,.9); backdrop-filter:blur(8px); }
    header a { color:var(--muted); text-decoration:none; margin-left:16px; }
    header a.brand { color:var(--text); font-weight:700; margin:0; font-size:16px; }
    main { max-width:920px; margin:0 auto; padding:32px 24px 80px; }
    h1,h2,h3 { line-height:1.3; }
    h1 { font-size:32px; } h2 { margin-top:36px; border-bottom:1px solid var(--border); padding-bottom:6px; }
    a { color:var(--accent); } code { background:#0a1017; border:1px solid var(--border); border-radius:5px; padding:1px 5px; }
    pre { background:#0a1017; border:1px solid var(--border); border-radius:10px; padding:16px; overflow:auto; }
    pre code { border:none; padding:0; background:none; }
    table { border-collapse:collapse; width:100%; margin:16px 0; }
    th,td { border-bottom:1px solid var(--border); padding:8px 10px; text-align:left; }
    blockquote { margin:16px 0; padding:10px 16px; border-left:3px solid var(--accent); color:var(--muted); background:#0d131b; }
    img { max-width:100%; }
    footer { color:var(--muted); font-size:13px; margin-top:48px; }
  </style>
</head>
<body>
  <header>
    <a class="brand" href="${prefix}index.html">CloudDeck</a>
    <nav>
      <a href="${prefix}index.html">首页</a>
      <a href="${prefix}00-product.html">文档</a>
      <a href="${prefix}openapi.html">API</a>
      <a href="https://github.com/wly2lcl/CloudDeck">GitHub</a>
    </nav>
  </header>
  <main>${body}<footer>CloudDeck documentation · MIT</footer></main>
</body>
</html>`

function rewriteLinks(html: string): string {
  return html.replace(/href="([^"]+)"/g, (_match, href: string) => {
    if (href.startsWith('http') || href.startsWith('#') || href.startsWith('mailto:')) return `href="${href}"`
    if (href === 'package.json') {
      return 'href="https://github.com/wly2lcl/CloudDeck/blob/main/package.json"'
    }

    const [pathPart, hash] = href.split('#')
    let next = pathPart ?? ''
    if (next.startsWith('docs/')) next = next.slice('docs/'.length)
    if (next === 'docs/adr/' || next === 'adr/') next = 'adr/README.html'
    else if (next.endsWith('.md')) next = `${next.slice(0, -3)}.html`
    else if (next === 'LICENSE') next = 'LICENSE.html'
    return `href="${next}${hash ? `#${hash}` : ''}"`
  })
}

function rewriteImages(html: string): string {
  return html.replace(/src="([^"]+)"/g, (_match, src: string) => {
    if (src.startsWith('http') || src.startsWith('data:')) return `src="${src}"`
    if (src.startsWith('docs/assets/')) return `src="${src.slice('docs/'.length)}"`
    return `src="${src}"`
  })
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(full)))
    else if (entry.name.endsWith('.md')) files.push(full)
  }
  return files
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true })
  await cp(join(DOCS, 'assets'), join(OUT, 'assets'), { recursive: true })

  const files = await walk(DOCS)
  for (const file of files) {
    const relativePath = relative(DOCS, file)
    const output = join(OUT, relativePath.replace(/\.md$/, '.html'))
    await mkdir(dirname(output), { recursive: true })
    const markdown = await readFile(file, 'utf8')
    const titleMatch = /^#\s+(.+)$/m.exec(markdown)
    const title = titleMatch?.[1]?.trim() ?? relativePath
    const html = rewriteImages(rewriteLinks(marked.parse(markdown) as string))
    const depth = relative(OUT, dirname(output)).split(pathSeparator).filter(Boolean).length
    await writeFile(output, PAGE(title, html, '../'.repeat(depth)))
  }

  const rootPages = [
    'README.md',
    'README.zh.md',
    'CHANGELOG.md',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'CODE_OF_CONDUCT.md',
    'THIRD_PARTY_NOTICES.md',
  ]

  for (const name of rootPages) {
    const markdown = await readFile(join(ROOT, name), 'utf8')
    const titleMatch = /^#\s+(.+)$/m.exec(markdown)
    const title = titleMatch?.[1]?.trim() ?? name
    const html = rewriteImages(rewriteLinks(marked.parse(markdown) as string))
    await writeFile(join(OUT, name.replace(/\.md$/, '.html')), PAGE(title, html))
  }

  const readme = await readFile(join(ROOT, 'README.md'), 'utf8')
  const readmeHtml = rewriteImages(rewriteLinks(marked.parse(readme) as string))
  await writeFile(join(OUT, 'index.html'), PAGE('CloudDeck', readmeHtml))

  const license = await readFile(join(ROOT, 'LICENSE'), 'utf8')
  await writeFile(
    join(OUT, 'LICENSE.html'),
    PAGE('License', `<h1>License</h1><pre><code>${license.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string)}</code></pre>`),
  )

  const openapi = await readFile(join(DOCS, 'openapi.yaml'), 'utf8')
  await writeFile(
    join(OUT, 'openapi.html'),
    PAGE('OpenAPI', `<h1>OpenAPI</h1><p>规范文件：<a href="openapi.yaml">openapi.yaml</a></p><pre><code>${openapi.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string)}</code></pre>`),
  )
  await cp(join(DOCS, 'openapi.yaml'), join(OUT, 'openapi.yaml'))

  console.log(`docs site built: ${files.length + 2} pages`)
}

main().catch((error) => {
  console.error('docs build failed', error)
  process.exit(1)
})
