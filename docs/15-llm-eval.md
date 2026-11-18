# 15 LLM 评测集

固定样例用于比较模型与提示词版本，避免「凭感觉调 prompt」。

## 用例

`evals/cases.json`：

- `novel-continue`：续写，检查长度、关键人物/地点、套话数量
- `script-json`：剧本 JSON，检查合法 JSON、场景数、关键人物
- `storyboard-json`：分镜 JSON，检查合法 JSON、镜头数、关键人物

样例在 `evals/fixtures/`，检查逻辑在 `scripts/eval-lib.ts`。

## 运行

```sh
# 仅启发式基线（无需模型）
pnpm eval:llm

# 对比真实模型
LLM_HTTP_URL=https://your-gateway/v1 \
LLM_MODEL=your-model \
LLM_HTTP_TOKEN=... \
pnpm eval:llm
```

输出 `eval-report.json`，每行包含 `score`、`passed`、指标与失败原因。

## 评分

- 长度、关键词、禁用套话、JSON 合法性与场景/镜头数
- 低于 70 分或存在硬性失败项即 `FAIL`
- 模型调用失败会记录 `model-error`，不中断其它用例

## 注意

- 评测会真实消耗 token；429 时限流由 provider 重试，仍失败则记录错误。
- 样例与阈值应随产品目标演进，变更时在 CHANGELOG 说明。

## 引用溯源

`novel.edit` 的 RAG 选中章节会写入任务产物的 `citations.json`（资产名 `citations`），可用于人工核对生成内容引用了哪些章节。

## 检索评测

```sh
SILICONFLOW_API_KEY=... pnpm eval:retrieval
```

- 语料：`evals/fixtures/large-novel.md`（8 章）
- 用例：`evals/retrieval-cases.json`（问题、目标章节、目标短语）
- 输出：词法 vs 向量检索的章节命中、短语命中与引用行号
- 实测：4/4 用例词法/向量均命中，向量引用定位到具体行

`citations.json` 现在包含 `chapter`、`startLine`、`endLine`、`score`，可直接定位原文段落。
