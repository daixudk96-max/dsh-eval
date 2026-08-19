# 评测与自进化系统 —— 集成实施计划（implement.md）

> 父任务的实施以**子任务执行**为主线（见 §1 执行顺序）；本文件负责集成验收、AC→Test 映射、验证命令与回滚点。各子任务内部顺序见其自身 `implement.md`。
> `task.py start` 前需用户对本规划 summary 的显式批准。

## 1. 子任务执行顺序

```
① eval-adapter-spike（M1）  →  go/no-go 决策物（design §2.2 / ADR D2）
      ↓
② preset-registry（M2）     →  resolveCurrent / Candidate / CAS promote / GC
      ↓
③ evolution-controller（M3）→  状态机 / Code Gate / promote 接线 / 审计
      ↓
④ system-presets（M4）      →  system-evaluator / system-evolver + Host capability
      ↓
⑤ request-api-integration（M5）→ 业务 Preset 仅 request_* + 异步 Job 契约
      ↓
⑥ security-hardening（M6）  →  blind holdout 隔离 / paired 统计 / GC / 泄漏防护
```

依赖关系已在各子任务 `prd.md` 写明（非树位置隐含）。②③ 可并行起跑（均依赖①），但 promote 接线需②完成。

## 2. 集成验收（父级 AC → Test 映射）

| 父 AC | 验证方式 | 执行位置 |
|-------|----------|----------|
| AC1 resolveCurrent 稳定 | `resolveCurrent('coding') → coding-rN` 单测 + 冒烟 | preset-registry |
| AC2 老 Session 固定 revision | 集成：改 current 后 resume 旧 Session，header 不变（generation 语义） | preset-registry + 集成测试 |
| AC3 失败 Candidate 不动 current | 集成：构造 FAIL candidate → current 不变；EvolutionRun 可查 | evolution-controller |
| AC4 仅 Controller+用户可 Promote | Host capability 集成测试：evolver 调 promote 被拒 | system-presets |
| AC5 同一 Epoch 六重锁 | 数据契约校验：baseline/candidate run 的 epochId 相同且 digest 一致 | eval-adapter-spike + evolution-controller |
| AC6 Revision 不可原位修改 | digest 校验单测 + 只读区文件检查 | preset-registry |
| AC7 Gate 纯代码三态 | 伪 run 单测：PASS/FAIL/INCONCLUSIVE/INVALID | evolution-controller |
| AC8 Session 可重建 | header(logicalPreset/revision/digest) 重建冒烟 | preset-registry |
| AC9 Rollback O(1) | rollback 后 history 完整 + 时延不随内容增长 | preset-registry |
| AC10 Epoch 升级可复现 | 新 Epoch 建立后旧 run 仍可回放 | evolution-controller |
| AC11 仅 request_* | 工具清单断言：业务 Preset 无 evolve_*/promote/rollback | request-api-integration |

## 3. 验证命令总表

```powershell
# 子任务内单测（vitest，沿 agent-presets spec 风格）
pnpm vitest run <包>/test/preset-registry
pnpm vitest run <包>/test/evolution-controller

# 集成冒烟
dsh --profile web --dump-config | grep -iE 'preset-registry|evolution|eval|resolveCurrent'
dsh eval run eval/benchmarks/demo.yaml --out .eval-reports/run.json

# 任务状态跟踪（注意：不是 task.py status）
python ./.trellis/scripts/task.py current --source
python ./.trellis/scripts/task.py validate <task-dir>
python ./.trellis/scripts/task.py list
```

## 4. 高风险文件 / 回滚点

- `preset-registry` 的 pointer 原子写与 CAS（崩溃恢复靠 ledger 重放）—— **回滚点：registry 数据目录可整体重建（无存量，不污染主 profile）；代码回退上一 Package**。
- `evolution-controller` 的 Gate 与 approval 绑定（误判 → 只写审计，不自动改 current）—— **回滚点：controller 无状态，回退 Package 即恢复**。
- agent factory setup 钩子（改错会让所有新 Session 无法挂载 → 先灰度到独立 logicalId）。
- 任何对 `~/.dsh/.agent-presets` 的写入（DSH 用户 preset 根，当前未创建，无存量冲突）。
- 对 `E:\github\dsh` 的**只读约束**：一旦出现对该仓库的写操作即视为越界，立即回退。

## 5. 元数据核对（start 前）

已就绪（2026-08-19）：
- [x] git 仓库：`E:\github\dsh-eval` 已 `git init -b main` 并初始提交（`4ce49ec`），工作区干净。
- [x] `task.json`：scope=`eval+evolution`、branch=`eval-evolve`、base_branch=`main`、package=`dsh-eval`（meta）、priority=P1、assignee=daixu。
- [x] 全部 7 个任务 `task.py validate` 通过（jsonl 上下文已补齐）。
- [x] 6 个子任务已建并链接（`add-subtask`，见 prd.md 任务清单）。

start 时执行：
- [ ] PRD 最终确认（用户对本规划 summary 的显式批准）。
- [ ] `git checkout -b eval-evolve`（实现分支，消除 validate 的 branch 不存在警告）。
- [ ] 确认 web profile 下 dsh-eval 的 rc 版本 peer 兼容（M1）。
- [ ] 确认 production approval 策略（当前会话 never；生产须 human answerer）。

## 6. start 前命令

```powershell
git checkout -b eval-evolve
python ./.trellis/scripts/task.py validate 08-19-eval-evolve
```

> 启动按子任务逐个 `task.py start <子任务>` 进入 Phase 2；父任务在最后做集成验收后 `archive`。
