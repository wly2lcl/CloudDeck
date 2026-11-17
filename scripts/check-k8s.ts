import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parseAllDocuments } from 'yaml'

const dir = 'infra/k8s'
const files = (await readdir(dir)).filter((file) => file.endsWith('.yaml'))
let documents = 0

for (const file of files) {
  const parsed = parseAllDocuments(await readFile(join(dir, file), 'utf8'))
  for (const document of parsed) {
    if (document.errors.length > 0) throw document.errors[0]
    const value = document.toJS() as { apiVersion?: string; kind?: string }
    if (!value) continue
    if (!value.apiVersion || !value.kind) {
      throw new Error(`${file} 缺少 apiVersion/kind`)
    }
    documents += 1
  }
}
console.log(`K8s 清单校验通过：${files.length} 个文件 / ${documents} 个资源`)
