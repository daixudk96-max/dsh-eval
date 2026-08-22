# 执行清单 —— 缩小 sample session 重跑闭环

## P2R-1 缩小样本

- [x] **P2R-1a** 解压 sample-session.jsonl.zstd(多帧容器, 用 dsh-eval `decodeZstdSession`)→
      4.4MB 明文 / 3227 行 / 16 turns / 108 steps / 126 tool calls
- [x] **P2R-1b** 截取前 2 个完整 turn(345 行)→ 重压 zstd 单帧 → sample-session-small.jsonl.zstd 112KB
      (原 1.6MB, 14 倍缩小; 保留 2 turns/15 steps/20 tool calls 含失败点)
- [x] **P2R-1c** `import` 试跑成功: tool success 95.0%, 15 steps(小样本有效, 含可分析失败)

## P2R-2 工作区更新

- [x] **P2R-2a** 覆盖 evaluate-preset-p2 / evaluate-preset-p2-baseline 的 sample-session.jsonl.zstd(112KB)
- [x] **P2R-2b** prompt/check 引用不变(./sample-session.jsonl.zstd)

## P2R-3 真实评测

- [x] **P2R-3a** baseline 跑一轮 → run-evalpreset-p2-baseline-small-2026-08-23.json(后台 pwsh-1)
- [x] **P2R-3b** candidate 跑一轮 → run-evalpreset-p2-small-2026-08-23.json(后台 pwsh-2)

## P2R-4 finish 判定

- [ ] **P2R-4a** `node research/evolution-p2.mjs finish --run ... --baseline ...`
- [ ] **P2R-4b** PASS → 请求用户 approvalId → promote
- [ ] **P2R-4c** FAIL/INCONCLUSIVE → 记录原因, 不 promote

## P2R-5 收尾

- [ ] **P2R-5a** 汇报用户(含 run.json 证据)
- [ ] **P2R-5b** commit + 归档任务 + journal
