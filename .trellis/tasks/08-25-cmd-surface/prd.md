# PRD — P1 命令面补全(cmd-surface)

## 背景
`bin/dsh-evolve.js` 进化闭环 CLI 已有:闭环模式(--benchmark/--registry/--logical/--candidate/--auto/--approve/--split/--min-effect/--dsh/--out)、归档模式(--export/--import)、状态模式(--status)、失败聚合(failures 子命令)、proposer(--auto/--proposal-run/--model/--api-key-env)。

方向 2 差距(已核实代码):
1. **printStatus `_safeFileId` 假 id bug**(P3 check 观察项):`printStatus` 直接读 `registry.dirs.logical` 目录文件名当 logicalId,但文件名经 `registry._safeFileId` 编码(`%`→`%25`、`:`→`%3A`,registry.js:87)。`state:prompt:style` 类 id 显示为 `state%3Aprompt%3Astyle` 假 id,随后 `resolveCurrent(假id)` 二次编码 → 找不到 → `current: (none)` 假阴性。registry 只有编码无公开解码。
2. **--budget 参数未暴露**:controller.js:39 已支持 `budget: { dir, limitUsd }`(BudgetLedger,newRun 前查 remaining,超预算 throw),但 dsh-evolve.js 构造 controller 未传 budget。

## 需求
- R1: registry 增公开 `decodeFileId(encodedId)`(编码逆操作);`printStatus` 用解码后 id 调 resolveCurrent/history,修假 id 与二次编码。
- R2: dsh-evolve.js 增 `--budget-dir <dir>` 与 `--budget-limit <usd>` 参数;两者齐备时构造 controller 传 budget(单侧给只警告不启用,避免误配置静默无预算)。超预算 newRun → 明确错误消息 + exit 1。
- R3: 闭环模式与归档/状态模式参数互斥校验保持(不破坏现有)。

## 验收(AC)
- AC1: `node packages/evolution-controller/bin/dsh-evolve.js --status --registry C:/Users/daixu/.dsh/preset-registry` 输出 `evaluate`(及任何含 `:`/`%` 的 logical id)正确解码,current 指针/approvalId 非假阴性。
- AC2: `--budget-dir <tmp> --budget-limit 0` 下跑闭环 → newRun 前拒绝,错误含 `evolution budget exhausted`,exit 1;预算充足时闭环正常。
- AC3: 单侧参数(仅 --budget-dir)不崩溃,警告说明需两参齐备。
- AC4: evolution-controller 全量测试(node test/<file>.test.js 单进程)全绿;新增测试覆盖 decodeFileId 往返与 printStatus 解码。

## 范围外
- --export/--import/--registry 已实现(P0-4),不动。
- UCB-Air(方向 1)另任务。
