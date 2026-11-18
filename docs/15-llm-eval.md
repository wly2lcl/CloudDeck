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
