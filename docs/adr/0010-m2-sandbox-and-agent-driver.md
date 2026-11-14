# ADR-0010 M2 沙箱抽象与 agent driver 接入

- 状态：已接受
- 日期：2026-11-14

## 背景

M2 需要让第三方 agent（首个为 Claude Code）在受控环境中执行任务。驱动不能直接 `spawn`，否则沙箱、超时、进程树清理与密钥注入会分散到每个驱动里；同时本地开发环境不一定有 Docker。

## 决策

1. **统一命令执行契约**：`TaskContext.commands: CommandRunner`，由 runner 注入。
   - `LocalSandbox`：本地子进程，独立进程组，超时/取消时先 SIGTERM 再 SIGKILL；环境变量按白名单 + 显式注入合并。
   - `DockerSandbox`：`docker run --rm --init --read-only --tmpfs /tmp --user 1000:1000 --memory --cpus`，只挂载工作区根目录，网络默认 `none`。
2. **驱动只构建命令与映射事件**：Claude Code driver 使用 `-p --output-format stream-json --include-partial-messages --add-dir <workspace>`，通过 stdin 传提示词，逐行解析 NDJSON。
3. **产物契约**：agent 必须把结果写入 `output/result.md`，驱动按能力 manifest 的首个 output 声明资产类型；缺失产物返回 `NO_ARTIFACT`。
4. **密钥**：只注入 manifest `permissions.secrets` 声明的变量，来源为 runner 进程环境（M2 为平台级，M3 接租户 BYOK）。
5. **测试**：用假的 CLI（Node 脚本）验证 stream-json 映射、失败、取消与缺产物；真实 Claude Code 冒烟需要 API key，单独执行，不进入 CI。
6. **OpenCode**：本机未安装，未验证其 server/run 接口，M2 不交付未经验证的适配器；接口已预留，M3 再接入。

## 为什么本地模式不是安全边界

`LocalSandbox` 只做进程与环境隔离，无法限制网络和文件系统。它用于本地开发与 CI；生产必须使用 Docker（后续 gVisor）。manifest 的 `permissions.network` 在本地模式下不生效，这一点已写入驱动文档，避免误判。

## 后果

正面：
- 驱动不感知沙箱实现，换本地/容器只改 runner 配置。
- 超时、取消、进程树清理、环境过滤集中在一处。
- 假 CLI 让 agent 驱动可确定性测试，不消耗模型额度。

代价：
- Docker 模式的网络白名单尚未实现（当前只能 `none` 或 `bridge`）。
- 本地模式与生产行为存在差异，需要文档明确标注。
- agent 产物约定（`result.md`）是驱动级约定，能力作者需要遵守。

## 回滚条件

- 若第三方 agent 无法适配 `result.md` 约定，改为由 manifest 声明产物路径模式。
- 若 Docker 网络需求变复杂，引入 egress 代理与域名白名单，而不是放开 `bridge`。
