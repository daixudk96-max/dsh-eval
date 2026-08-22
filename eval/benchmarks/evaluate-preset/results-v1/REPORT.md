# Eval Report: sample-session

- **Benchmark**: import:dsh
- **Model**: deepseek-v4-flash:0731
- **Trials**: 1
- **Case**: sample-session (status: completed)
- **Created**: 2026-08-22T09:33:01.571Z
- **Source trace**: `./sample-session.jsonl.zstd` (native DSH session log, not modified)

## Metrics

| Metric | Value |
|---|---|
| Steps | 107 |
| Tool calls | 126 |
| Tool results | 124 |
| Tool success | 120 (96.8%) |
| Invalid tool calls | 4 |
| Retries | 0 |
| Tokens (total) | 8,178,281 |
| Tokens (input) | 8,037,070 |
| Tokens (output) | 141,211 |
| Turns | 16 |
| Latency | 57,921,060 ms (~16.1 h) |

### Per-trial breakdown

| case | trial | status | steps | tools | success | invalid | retries | tokens | latency ms |
|---|---|---|---|---|---|---|---|---|---|
| sample-session | 1 | completed | 107 | 126 | 96.8% | 4 | 0 | 8178281 | 57921060 |
| aggregate | – | completed | 107.0 | 126.0 | 96.8% | 4.0 | 0.0 | 8178281.0 | 57921060.0 |

## Conclusion

该会话共执行 107 步、调用工具 126 次，工具成功率约 96.8%，共消耗约 818 万 tokens（输入 803.7 万、输出 14.1 万）。整体任务完成度较高：4 次无效工具调用被正确记录且无重试，说明 agent 在长时间（约 16 小时）的工作中保持稳定；输入 tokens 占比极高，提示会话上下文累积较大，可考虑精简上下文以降低成本。
