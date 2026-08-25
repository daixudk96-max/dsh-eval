# system-evolver 工具面实战报告(2026-08-25)

任务: 08-25-system-evolver-tools-field — 用 `packages/system-presets/plugins/evolution-tools.js`
的 execute 函数链驱动 evaluate preset 一轮完整真实进化, 验证工具链路。

## 结论(一页摘要)

**工具链全链路验证达成**; 本轮候选被真实评测**诚实拒绝**(gate FAIL, 效率回归),
未 promote, 未伪造任何分数。同时**修复了评测模型路由错误**(clipa/火山引擎订阅失效
→ ollama 云真实可用), 并修复了 executeRun 的三处接线缺陷。

## 链路逐工具结果

| 步骤 | 工具 | 结果 | 证据 |
|---|---|---|---|
| 证据获取 | (CLI 评测) | ✅ baseline 真实跑通 | run-field2-baseline.json: taskSuccess 1.0, 36 步, 40 toolCalls, 97.5% 成功 |
| 生成候选 | executePropose | ✅ 干净证据诚实拒绝 → 用户批准降级 → 产出候选 | proposal.json 8252B; hypothesis+mutations+candidateFiles |
| 微调 | executeMutate | ➖ 跳过(propose 已完整, 设计允许) | — |
| 物化 | executeCandidate | ✅ staging 物化 | cand-e762388cffa20b86 |
| 评测+门禁 | executeRun | ✅ 真实评测 + gate 判定 | baseline.json 2659B / candidate.json 2657B / gate.json 617B |
| 晋升 | promote | ➖ **不适用**: gate FAIL, 无 ACCEPTED 候选 | — |

## 最终闭环数字(ollama / deepseek-v4-flash:0731)

| 维度 | baseline | candidate | 判定 |
|---|---|---|---|
| overall / correctness / safety / verification | 1.0 / 1.0 / 1.0 / 1.0 | 1.0 / 1.0 / 1.0 / 1.0 | 持平 |
| steps | **40** | **50** | 效率回归 |
| toolCalls | 46 | 64 | — |
| toolSuccessRate | 100% | 100% | — |
| tokens | 2,952,204 | 3,400,290 | — |
| taskSuccess | ✅ | ✅ | — |
| **gate** | | | **FAIL: efficiency regression: candidate steps 50 > baseline steps 40** |

候选假设(「persona 硬编码 CLI launcher 路径」修正)经真实评测否决: 加入显式指令后
agent 反而多走 10 步。**Code Gate 的价值验证: LLM 假设必须过真实评测, 不提升不
promote。** 失败候选只写审计, 不进历史表, current 指针保持 evaluate-94a7c40b。

## 缺陷与修复(真实教训)

1. **executeRun 不区分 baseline/candidate 评测**(原只透传单 --benchmark): 对
   「workspace 内容=被测 preset」的评测形态, 两轮评测会跑相同内容, 候选内容进不了
   评测环境。修复: 增 benchmarkBaseline/benchmarkCandidate 参数, cmdArgs 按存在性
   push --benchmark-baseline / --benchmark-candidate。
2. **execFile 超时/错误被吞**: 600s 固定超时在双评测闭环下必然被杀, 且不检查
   outcome.err, 报误导性 'dsh-evolve finished without gate.json or result.json'。
   修复: timeoutMs 参数默认 2_400_000(40min), outcome.err 透传 stderr tail 8 行。
3. **评测模型路由错误**(用户质疑驱动): 
   - 评测子进程模型**不继承主会话 GUI 设置**, 由 benchmark yaml 的 provider/model
     决定(wrapper.cjs 重建 child settings.yaml)。
   - 8-22 修评测引擎时把 14 个 benchmark yaml 硬编码 provider: clipa(当时 ollama
     云路由 0 tokens 失败, 根因实为 model 缺 :0731 后缀不匹配)。
   - clipa 本地网关(127.0.0.1:8317)转发火山引擎 ark, 账号 2125384065 CodingPlan
     订阅失效 → InvalidSubscription 400, gate 报 INVALID(evidenceOk 机制生效)。
   - **ollama 云(https://ollama.com/v1)实测可用**: models 200 含 deepseek-v4-flash:0731
     与 :preview 等; 切换 provider: ollama, model: deepseek-v4-flash:0731 后真实跑通。
   - settings.yaml 现状: agent-default-model = clipa/gemini-3.7-flash(79-82 行),
     subagent-defaults = clipa/gemini-3.7-flash, graph-runtime 默认 =
     ollama/deepseek-v4-flash:0731(117-121 行)。
4. **驱动脚本参数解析**: kebab-case(--benchmark-baseline)与驼峰(arg('benchmarkBaseline'))
   不匹配 → arg() 支持双拼写; run 步 logicalId 与 --logical 不匹配 → 兼容两者。
5. **超时预算**: ollama 云较慢, 600s 不够(27 步 1.47M tokens 纯超时无错误) →
   benchmark timeoutMs 1500000(25min), executeRun --timeoutMs 3600000。

## 诚实标注

- 干净 baseline 无失败 case → executePropose 诚实拒绝(ok:false)。降级使用历史失败
  证据(run-evalpreset-p2-2026-08-22.json)经**用户明确批准**, 报告如实标注证据来源。
- 本轮无 promote: gate FAIL, 不伪造提升。若后续仍想推进 CLI 路径指令候选, 需在
  订阅恢复的引擎上重新获得干净双评测证据后再议。
- executeRun 内部评测子进程 exit 1 的错误透传已在修复 #2 中覆盖(本轮最终轮成功)。

## 遗留观察

- eval/benchmarks/ 下其余 benchmark yaml 仍硬编码 provider: clipa(火山订阅失效后
  会 400)。建议后续批量评估: 切 ollama 或按 settings 默认路由。
- evolution-tools.js 的 executeRun schema 已增 benchmarkBaseline/benchmarkCandidate/
  timeoutMs, 但 README 示例尚未同步(小项, 下次任务顺手)。
