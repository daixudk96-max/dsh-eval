# Eval Report: import:dsh — sample-eval

- 基准（benchmark）: `import:dsh`（DSH 原生会话导入评测）
- 模型（model）: `deepseek-v4-flash:0731`
- 会话源: `E:\github\dsh-eval\eval\benchmarks\evaluate-field-candidate\sample-session.jsonl.zstd`
  (会话 `session-a0c5c3a4-4b13-4d00-9cff-21cfcb3f40bc`, cwd `E:\github\dsh-eval`, agentPreset `cordis`)
- trial 数: 1（caseId `sample-eval`, status `completed`, exitCode null, timedOut false）

## 指标表 Metrics

| case | trial | status | steps | tools | success | invalid | retries | tokens | cost | latency ms | task | tool-acc |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sample-eval | 1 | completed | 15 | 20 | 95.0% | 1 | 0 | 643867 | – | 1555860 | – | – |
| aggregate | – | completed | 15.0 | 20.0 | 95.0% | 1.0 | 0.0 | 643867.0 | – | 1555860.0 | – | – |

分项明细（来自 `eval-report.json` cases[0].metrics）:

| 指标 | 值 |
|---|---|
| turns | 2 |
| steps | 15 |
| tool calls | 20（glob×2, pwsh×4, read×14） |
| tool results | 20 |
| tool success | 19 / 20 = 95.0% |
| invalid tool calls | 1 |
| retries (llm/retry) | 0 |
| input tokens | 635,495 |
| cache read / cache write tokens | 0 / 0 |
| output tokens | 8,372 |
| total tokens | 643,867（input 占比 98.7%） |
| context tokens | 635,495 |
| llm ms | 78,572 |
| tool ms | 26,331 |
| ttft ms（平均首 token 延迟） | 49,825 |
| latency ms（首事件→末事件墙钟） | 1,555,860（≈25.9 分钟） |
| cost usd | –（未配 pricing） |

## 中文总结

本次评测把一段已完成的 DSH `cordis` 会话（2 个 turn、15 个 step、20 次工具调用）导入为评估 trace，并折叠出自动指标。

**总体表现良好**：工具成功率 95%（19/20），全程无 LLM 重试（`llm/retry` 事件为 0），且唯一一次失败是**读取不存在的文件**（`FsError: FS_NOT_FOUND`），属于对真实文件系统状态的自然误判——工具调用参数本身 schema 合法、无可检索的"参数非法"类失效，因此未见 prompt-following/参数校验类失败簇。

会话主线清晰：第 1 turn 用户问「你好，你能评测什么？」，agent 先 glob/pwsh/read 探查评测能力与文档（含一次 `docs/final-report.md` 读取落空），随后第 2 turn 用户追问「进化逻辑和进化流程是怎么样的？」，agent 转入以 read 为主的验证/复读阶段（10 次工具调用全部为 read+pwsh），体现明显的"先探索、后核对"两阶段结构。

**成本面观察**：本会话是高度"输入驱动"的——总 tokens 643,867 中 input 占 635,495（98.7%），output 仅 8,372，且 cacheRead/cacheWrite 均为 0；单次 turn 内还注入了多条 system/skill/trellis 系统消息（user/message 事件 7 条 > turns 2）。这提示：长上下文会话在无 prompt-cache 收益记录的情况下，token 计量主要压在 input 侧，评估报告若后续接入 pricing 将直接反映这一成本结构。另外墙钟 latency 1,555,860 ms 显著大于 llmMs(78,572)+toolMs(26,331) 之和——导入 trace 的事件时间戳包含真实会话的跨轮等待/队列间隔，不能把 latencyMs 当作纯执行耗时。

## Failure clusters

- **tool-call/fs-read（1 例）**: turn 1 step 4，`read` 调用 `call_hm3ntvmw|fc_780763_0`（call seq 366 → result seq 368）读取 `E:\github\dsh-eval\docs\final-report.md` 失败：`FsError` code `FS_NOT_FOUND`；该 result 同时计入 1 次 tool 失败（isError）与 1 次 invalidToolCall（data.error 非空）；后续无重试（retries=0）。
- **token/latency 低效模式（1 组）**: 20 次工具调用 / 15 steps 下 totalTokens 643,867、input 占 98.7%、cacheRead/cacheWrite=0；每 turn 注入多条 system/skill 系统消息推高 input；平均 TTFT 49.8s、墙钟约 25.9 分钟，且 latencyMs≫llmMs+toolMs，属事件时间戳含等待间隔所致。建议后续用例核查会话记录是否缺 cache 计费、并缩短单 turn 上下文注入。
- （空簇说明）: prompt-following/basic、tool-call/schema-invalid、llm-retry 均无证据——唯一失效为真实文件缺失，非参数/指令违规。

## 产出文件

- `E:\github\dsh-eval\eval\benchmarks\evaluate-field-candidate\eval-report.json`（CLI import 生成）
- `E:\github\dsh-eval\eval\benchmarks\evaluate-field-candidate\REPORT.md`（本文件）