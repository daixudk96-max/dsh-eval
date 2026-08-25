# Implement: system-evolver 工具面实战 —— evaluate 新一轮真实进化

## 前置状态(已确认)

- 真实 registry: `C:/Users/daixu/.dsh/preset-registry`, evaluate 链 active
  = evaluate-94a7c40b(digest 94a7c40b8283…, gateRun evr-mt82l8v7-pkxdp6,
  approval user-approved-unattended-2026-08-25)。revisionContent 接收 64-hex
  digest(非 revisionId)。
- baseline 内容: registry.revisionContent('94a7c40b8283…') 同步到
  `eval/benchmarks/evaluate-field-baseline/` 三文件。
- 评测基准: `eval/benchmarks/evaluate-field-baseline|evaluate-field-candidate-benchmark.yaml`
  (最终 provider **ollama** / model deepseek-v4-flash:0731, command wrapper.cjs
  --preset-src <workspace>, trials 1, timeoutMs **1500000**, case eval-real-session:
  import sample-session.jsonl.zstd → eval-report.json → REPORT.md)。
- 工具插件: `packages/system-presets/plugins/evolution-tools.js`(ESM, execute 函数导出)。
- 测试形态: node test/<file>.test.js 单进程。

## 步骤

### P1. 环境准备(工具脚本)
- [x] 确认 clipa 服务活(8317 探测 → 401 = 服务在, 无凭证)。
- [x] 确认当前 evaluate 指针与 revisions 内容可取(revisionContent 94a7c40b → 三文件)。
- [x] 建 `research/evolution-tools-field.mjs`(ESM 驱动脚本, 分步执行, 每步打印
  execute 返回 JSON; 含 arg() kebab-case 兼容、candidateDir 目录优先、timeoutMs 透传)。

### P2. 证据获取(真实 baseline 评测)
- [x] 真实跑一轮 `evaluate-field-baseline-benchmark.yaml` → run-field2-baseline.json:
  taskSuccessRate 1.0, toolSelectionAccuracyRate 1.0, 36 步, 40 toolCalls, 97.5% 成功。
- [x] 无失败 case → 记录"无失败证据", 询问用户 → **用户批准降级**用历史失败 run
  (run-evalpreset-p2-2026-08-22.json, 590s 超时 taskSuccessRate 0)。

### P3. executePropose(真实 LLM 生成)
- [x] 干净证据 → executePropose 诚实拒绝: `{"ok":false,"error":"proposer: no failed
  cases in run.json (nothing to fix)"}`。
- [x] 降级证据重跑成功: hypothesis=『persona 硬编码 CLI launcher 路径, 隔离 child
  环境 CLI 不在 PATH; 加显式指令用 wrapper 提供的 dsh 命令或全 node 路径+正确 cwd』;
  mutations=[{file:'agent.cordis.yml', op:'replace', summary:'替换硬编码 launcher 路径
  为 dsh 命令说明+验证命令存在规则+fallback 全 node 路径'}]; candidateFiles=[agent.cordis.yml]
  (6873B)。产物 proposal.json 8252B。
- [x] 候选目录补全三文件: preset.yml(157B)+README.md(1647B) →
  eval/presets/candidates/tools-field-2026-08-25/candidate/。

### P4. executeMutate(可选微调)
- [x] propose 已生成完整 candidateFiles, 无手工改动需求 → 跳过(设计允许)。

### P5. executeCandidate(真实 registry staging)
- [x] 读当前 revision 完整文件集(sourceRevisionId = evaluate-94a7c40b)。
- [x] executeCandidate → **cand-e762388cffa20b86** 物化成功(staging 三文件 +
  candidate.json)。

### P6. executeRun(真实评测 + gate)
- [x] executeRun({benchmarkBaseline, benchmarkCandidate, registryRoot, logicalId,
  split:'dev', minEffect:0.05, out, timeoutMs:3600000})。
- [x] 调试链三轮失败修复: ①kebab-case 参数不匹配 → arg() 双拼写; ②logicalId 缺失 →
  arg('logical')||arg('logicalId'); ③600s execFile 超时被吞 → timeoutMs 默认
  2_400_000 + outcome.err 透传 stderr tail。
- [x] 模型路由纠错(用户质疑驱动): clipa 本地网关→火山引擎 ark 账号订阅失效
  (InvalidSubscription 400, account 2125384065); **切换 provider: ollama,
  model: deepseek-v4-flash:0731**(ollama.com/v1 实测可用)。子进程模型不继承主会话
  设置, 由 benchmark yaml provider/model 决定。
- [x] 第 6 轮最终 gate: **FAIL — efficiency regression: candidate steps 50 >
  baseline steps 40**。baseline 40 步/46 toolCalls/2.95M tokens/taskSuccess✅;
  candidate 50 步/64 toolCalls/3.40M tokens/taskSuccess✅; 质量四维全 1.0 持平。
  gate.json runId evr-mt8ahnna-fc1kac。→ current 不动, 审计留痕, 任务诚实结束
  (P7 promote 不适用——gate 拒绝)。

### P7. promote(人审绑定)
- [x] **不适用**: gate FAIL, 无 ACCEPTED 候选 → 不申请 approvalId, 不 promote,
  不伪造分数。失败候选永不进历史表。

### P8. 收尾
- [x] 全量回归: evolution-controller + preset-registry + system-presets
  29 个 test 文件 0 失败; system-presets 工具测试 10/10(含新透传用例)。
- [x] 报告 research/system-evolver-tools-field-report.md(链路逐工具结果表 + 真实
  数字 + 缺陷/教训 + 诚实标注)。
- [x] 主会话提交 + task archive + journal。

## 验证命令

- 探测 clipa: `Invoke-WebRequest http://127.0.0.1:8317/v1/models` 或 curl。
- ollama 云可用性: `Invoke-RestMethod -Headers @{Authorization="Bearer $key"}
  https://ollama.com/v1/models`。
- 真实评测: `node E:\github\dsh\apps\cli\lib\bin.js --profile eval run ... --out ... --split dev`。
- 回归: 逐文件 `node packages/evolution-controller/test/<f>.test.js` 等。
- 工具测试: `node packages/system-presets/test/evolution-tools.test.js`。

## 回滚点

- 每步产物独立落盘(outDir), 失败可重跑该步。
- 本轮未 promote, current 保持 evaluate-94a7c40b, 无需回滚。
