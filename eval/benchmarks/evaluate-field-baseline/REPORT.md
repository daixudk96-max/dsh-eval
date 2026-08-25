# 评测报告: sample-eval (import:dsh)

- **会话**: `session-a0c5c3a4-4b13-4d00-9cff-21cfcb3f40bc` (创建于 2026-08-21T17:19:38Z)
- **来源**: `E:\github\dsh-eval\eval\benchmarks\evaluate-field-baseline\sample-session.jsonl.zstd` (112,465 字节)
- **模型**: `deepseek-v4-flash:0731`
- **评测方式**: `dsh --profile eval import dsh` → `eval-report.json` (case-id: `sample-eval`)
- **状态**: completed, exit 0, 未超时

## 指标表

| 指标 | 值 |
|---|---|
| steps（步数） | 15 |
| tool calls（工具调用） | 20 |
| tool success（工具成功率） | 95.0%（19/20 成功） |
| invalid tool calls（无效调用） | 1 |
| retries（重试） | 0 |
| tokens（总 token） | 643,867 |
| — input | 635,495 |
| — output | 8,372 |
| — cacheRead / cacheWrite | 0 / 0 |
| latency（总时长 ms，约 25.9 分钟） | 1,555,860 |
| — LLM 用时 | 78,572 ms |
| — 工具执行用时 | 26,331 ms |
| — TTFT 累计 | 49,825 ms |
| cost (USD) | –（无定价表, null） |
| turns | 2 |

> 注: 会话墙钟 1,555,860 ms 远大于 LLM+工具用时(约 105s), 差额主要为轮次间空闲(见 token/latency 聚簇)。

## 中文总结

本次评测对一段真实 DSH 会话(约 2 轮、15 步)进行了导入与指标统计。会话内容为关于 dsh-eval 项目的问答/探索: 用户先后询问"你能评测什么?"与"进化逻辑和进化流程是怎么样的?", 代理通过 12 次 glob/pwsh/read 工具调用阅读项目文件并回答, 行为基本符合预期。

**整体结论: 健康基线。** 20 次工具调用中 19 次成功(成功率 95%), 0 次重试; 唯一的失败是第 1 轮第 4 步对不存在文件 `E:\github\dsh-eval\docs\final-report.md` 发起 `read`(返回 `FsError: FS_NOT_FOUND`), 属于典型的"读取前未核实路径存在"的低危失误, 且代理在后续步骤自行纠正并继续, 未影响任务完成。

**两个值得关注的点:**
1. **上下文利用效率偏低**: 15 条 assistant 消息的全部读写均为 cacheRead/cacheWrite = 0, 输入 token 随每轮对话从 22K 单调增长到 63K, 累计 input 达 635K——说明该会话未启用前缀缓存, 长会话重复计费/逐条重发; 单条最大输出仅 2,419 tokens, 输出占比约 1.3%。
2. **轮次间存在长时间空闲**: 第 1 轮结束(17:21:04Z)到第 2 轮开始(17:45:07Z)有约 24 分钟空闲, 而 LLM 实际用时仅约 79 秒, 总时长主要被这段空闲占据。

总体而言该会话可作为 evaluate-field 基线的参照样本: 工具成功率 95%、无重试、任务有始有终, 但缓存未启用与轮间空档是后续优化点。

## Failure clusters

**Cluster 1 — tool-call/fs-read (未核验路径即读取)**
- 证据: `tool/call` `call_hm3ntvmw|fc_780763_0` (turn 1, step 4) `read` → 对应 `tool/result` 携带 `error: {"name":"FsError","code":"FS_NOT_FOUND"}`, `isError: true`, 内容 "Error: cannot read \"E:\github\dsh-eval\docs\final-report.md\": not found"。
- 影响: 本次唯一失败, 使 tool success 从 100% 降至 95%; 代理随后自行纠正(step 5-8 继续), 属可恢复性失误。
- 建议: 读取前先用 glob 校验路径存在性; 或对 FS_NOT_FOUND 这类确定性错误直接静默降级而非计入失败。

**Cluster 2 — token/latency (缓存未启用 + 轮间空档)**
- 证据: 15/15 条 assistant/message 的 usage 中 cacheReadTokens 与 cacheWriteTokens 恒为 0, input 单调 22,180→63,234, 累计 input 635,495; 墙钟 latencyMs 1,555,860 中 LLM 仅 78,572 ms, step 之间 (turn1 step8 @17:21:04Z → turn2 step1 @17:45:07Z) 存在约 24 分钟空档。
- 建议: 会话录制/回放场景确认前缀缓存开关; 评测计时口径上区分"有效推理耗时"与"空闲等待", 避免 latency 指标被空档放大。