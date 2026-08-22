# 设计 —— 缩小 sample session

## 1. 样本缩小方案

sample-session.jsonl.zstd 是真实 DSH 会话(zstd 压缩的 jsonl)。缩小方式:
解压 → 截取代表性前缀事件 → 重新 zstd 压缩。

- **工具**: eval profile bundle 内已有 zstd 依赖(`C:\Users\daixu\.dsh\profiles\eval\node_modules\zstd*`
  或 dsh-eval 的 import/trace 模块所用)。优先用 `dsh --profile eval import` 同款 zstd 库;
  若无, 用 `npx`/npm 临时 zstd 或真实 DSH 的 zstd 支持。
- **截取策略**: 保留会话开头(metadata/permission/sandbox)+ 前 2 个完整 turn 的所有事件
  (turn/start, step/start, user/message, assistant/chunk, tool/call, tool/result, step/end, turn/end)
  直至 2 个 turn 结束或 ~500KB 原始 jsonl(压缩后 <200KB)。
- **保真**: 逐行保留原始 JSON 对象(不重写), 只截断行数; 保证 import 能解析
  (它按行解析 jsonl)。

## 2. 工作区与 benchmark 更新

- `eval/benchmarks/evaluate-preset-p2/sample-session.jsonl.zstd` → 小样本(同文件名, 覆盖)
- `eval/benchmarks/evaluate-preset-p2-baseline/sample-session.jsonl.zstd` → 小样本(覆盖)
- prompt 无需改(引用 ./sample-session.jsonl.zstd 不变); check.js 不变(REPORT.md + 失败簇)。
- 评测预算 600s 不变。

## 3. 判定与 promote 流程

- 跑完 baseline/candidate 后: `node research/evolution-p2.mjs finish --run <candidate> --baseline <baseline>`
  - finish 会重建候选(evaluate-5dab277e 内容)、seal、evaluate、gate 判定;
  - ACCEPTED + 用户提供 approvalId → promote(需在脚本加 approvalId 参数或现场改脚本调用);
  - FAIL/INCONCLUSIVE → 记录原因, current 不动。
- 近重复/budget 演示在 finish 内已内置, 顺带展示。

## 4. 风险

- 小样本过短 → import 指标表太单薄(步骤少), check 仍过(REPORT.md+指标表+中文即可);
- 解压工具不可用 → 用 python(项目有 Python311)或 zstd CLI 检查; 最坏用真实会话重截。
