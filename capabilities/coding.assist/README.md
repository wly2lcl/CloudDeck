# coding.assist

M5 的可选能力：在隔离工作区中完成代码修改，输出补丁与说明。

- 驱动：`drivers/claude-code`
- 输入：`code_workspace`
- 输出：`patch`（当前以 `result.md` 形式返回变更摘要与 diff）
- 沙箱：`SANDBOX_DRIVER=docker` 时必须开启只读根、非 root、工作区挂载；网络按 manifest 放行
- 风险：代码执行能力需要更强隔离，正式对外前评估 gVisor / Firecracker（见 ADR-0012）

## 验收

- 给定仓库与需求，产出可应用的补丁说明
- 取消任务后无残留进程
- 未注入模型密钥时任务失败，错误可读
