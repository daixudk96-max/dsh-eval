# P0 实施计划：先诊断，再分阶段接线

- 当前状态：`planning`
- 本文件只描述实施顺序；当前不启动任务、不写产品代码。

## 0. 开工前检查（不改产品代码）

- [ ] 用户批准 `plan-overview.md` 与严格 fail-closed 契约。
- [ ] `trellis-before-dev` 读取 `packages/dsh-eval`、`packages/evolution-controller`、`packages/preset-registry` 的 `.trellis/spec/` 约束。
- [ ] 确认 P0 任务仍为 `planning`，再运行 `task.py start`；不得把当前 P4-UCB-Air 误激活。
- [ ] 建立本任务真实 `implement.jsonl`/`check.jsonl` 条目（若采用 sub-agent dispatch）；inline 执行则记录在本文件。
- [ ] 备份/记录当前真实 registry pointer 与 git HEAD，作为回滚证据。

## 1. P0-1 Judge：诊断与 evolution mapping

### 1.1 先做环境 smoke

- [ ] 使用已有 judge benchmark 在当前 `eval` profile 运行一次，不修改 score。
- [ ] 记录 service seam、provider route、credential bridge、LLM 回复解析的精确结果；失败时记录 `NO_LLM_SEAM`、`PROVIDER_CONFIG`、`CREDENTIAL_UNAVAILABLE`、`JUDGE_CALL_FAILED` 或 `JUDGE_OUTPUT_INVALID`。
- [ ] 只在真实 `run.grading.finalAnswerScore !== null` 且 `judgeDiagnostics.scored > 0` 时把真实 AC 标为通过。

### 1.2 复用现有 judge，补可观察诊断

- [ ] 仅在需要时增量修改 `packages/dsh-eval/src/judge.ts`、`packages/dsh-eval/src/types.ts`、`packages/dsh-eval/src/runner.ts`，给 null verdict 增可选 status/errorCode/run-level counters；不重复实现 stream/client。
- [ ] 保留 configured judge/no seam 的 fail-loud 契约：`packages/dsh-eval/src/runner.ts:471-477`。
- [ ] 增测试：call failure、invalid JSON、成功、多个 trial 聚合、敏感错误不落盘。

### 1.3 接 evolution gate

- [ ] 修改 `packages/evolution-controller/bin/dsh-evolve.js` 的 `evalEvidence(run)`，新增纯 helper `rubricEvidence(run, options)`：读取 finalAnswerScore/hallucinationRate/maxScore、归一化 0–100、输出 valid/source/regressions。
- [ ] 增 `--rubric-min-score`（默认 60）或等价配置；baseline/candidate judge score 缺失时不得默认跳过 rubric。
- [ ] 将 `rubric` 与 `epochSame`/`rubricValid` 传入 `controller.evaluate(...)`。
- [ ] 修改 `packages/evolution-controller/lib/gate.js`：rubric/epoch invalid 在 effect threshold 前返回 `INVALID`；清理重复头注（触及该文件时机械完成）。
- [ ] 增 `dsh-evolve` 集成测试：score mapping、低分拒绝、null 拒绝、hallucination regression、成功 audit。

**验证门 V1**

- [ ] `packages/dsh-eval` judge/runner/command 测试通过。
- [ ] evolution-controller gate/controller 测试通过。
- [ ] 真实 provider smoke 的 run/audit 证据已保存；若失败，P0 不伪造通过。

## 2. P0-2 Overfit：benchmark-specific candidate early reject

- [ ] 新增 `packages/evolution-controller/lib/overfit.js`，标注 `# absorbed-from: timwhitez/dsh-self-evolving specs/03 §9` 与 `research/dsh-self-evolution/src/candidate.ts:201-239`。
- [ ] 实现 `inspectOverfit({sourceFiles,candidateFiles,benchmarkMeta})`，使用确定性增量文本提取。
- [ ] 固定四类规则/阈值：digest；statement ≥40；private rubric ≥20；`case_id: <id>` 且 id ≥8。
- [ ] finding 只输出 code/kind/caseId/path；不得写命中片段或 rubric 原文。
- [ ] 在 `EvolutionController.createCandidate(...)` 写 staging 前执行；缺 frozen metadata 时 fail closed；旧调用无 metadata 时保持兼容（非 frozen）。
- [ ] 新增 `packages/evolution-controller/test/overfit.test.js` 与 controller 集成测试：四类拒绝、正常候选、source 继承不误报、staging 未创建、audit 脱敏。

**验证门 V2**

- [ ] `node packages/evolution-controller/test/overfit.test.js` 与相关 controller 测试单进程全绿。
- [ ] 真实构造一个背题候选，确认 `proposal-rejected` 审计与稳定错误 code。

## 3. P0-3 Frozen：semantic snapshot 与 epoch invalid

### 3.1 数据模型/loader

- [ ] `packages/dsh-eval/src/types.ts` 增可选 `Benchmark.frozen/materials/sourcePath/benchmarkDigest/caseHashes` 与 `EvalRun.status/benchmarkDigest/caseHashes/benchmarkSnapshot/epochChanged/notes`。
- [ ] `packages/dsh-eval/src/benchmark.ts` 增 `frozen`（默认 false）、显式 materials regular-file 校验、canonical semantic digest、caseHash；judge rubric 只 hash plaintext，不写 plaintext。
- [ ] 规定 digest 覆盖 case order/id/split/prompt/expected/judge rubric/maxScore/material bytes；provider/temp paths 仅 provenance。

### 3.2 Runner/CLI

- [ ] `packages/dsh-eval/src/runner.ts` 在 frozen run 开始捕获 snapshot，整轮结束 reload sourcePath/re-hash，发现 drift/missing/path error 时返回 invalid run：保留 trial evidence，`aggregate:null`、`grading:null`、非零退出。
- [ ] 非 frozen benchmark 记录 snapshot 但不因漂移 invalid；旧 run/import JSON 仍可读。
- [ ] `packages/dsh-eval/src/report.ts`/`compare.ts` 只在必要时显示 status/epoch mismatch，不把 invalid 当零分。
- [ ] `dsh-evolve` 读取两次 run 的 digest/status/epochChanged，计算 `epochSame` 并传 gate；invalid/digest mismatch → `INVALID`。

### 3.3 测试

- [ ] benchmark schema/path/symlink/material/prompt/rubric/expected/split hash 测试。
- [ ] fake child + mutation hook 测试：未变正常、运行中变更 invalid、材料缺失 invalid、非 frozen 兼容。
- [ ] dsh-evolve/gate epoch mismatch 测试。

**验证门 V3**

- [ ] `run.json` 明确保留 observed/expected/mismatch，不产生 grading 分数。
- [ ] frozen baseline/candidate digest 不同无法进入 promote。

## 4. P0-4 Registry：file-hashed export/import

### 4.1 Registry API

- [ ] 在 `packages/preset-registry/lib/registry.js` 增 `exportSnapshot(outPath)` 与 `Registry.importSnapshot({root,inPath,verify})`（或等价实例 API），不改 legacy digest。
- [ ] 导出全部 `logical/**`、`pointers/**`、`revisions/**`、原始 `ledger/ledger.jsonl`；排除 staging 与 `.tmp`。
- [ ] 每文件 base64 + sha256；canonical file list 计算 packageDigest；导出全部 revision，不受 rollbackWindow 限制。
- [ ] import 校验 schema/path/file hash/package hash/manifest digest/reference；只接受空 root；临时目录验证后提交，失败不污染目标。

### 4.2 CLI

- [ ] `packages/evolution-controller/bin/dsh-evolve.js` 在 required benchmark/logical 检查前解析 `--export`/`--import` 独立 mode。
- [ ] CLI 错误码、非空 root、篡改包、未知 schema 测试；不启动评测/LLM。

### 4.3 测试

- [ ] `packages/preset-registry/test/registry.test.js` 增多 logical、多 revision、完整 ledger/pointer、rollback-window 外 revision、round trip、file/package tamper、path traversal、non-empty target、import failure isolation、post-import recovery。
- [ ] 明确区分：legacy `verifyRevisionDigest(...)` 通过与 export file hashes 通过。

**验证门 V4**

- [ ] export → 新空 root import → `resolveCurrent/history/ledger` 一致。
- [ ] 全部 revision manifest digest 与每文件 hash 均通过。

## 5. 集成真实闭环与文档

- [ ] 真实 benchmark：judge score 非 null；低 rubric 候选拒绝；frozen drift invalid；overfit candidate 早拒；registry export/import 新 root 恢复。
- [ ] `packages/dsh-eval/README.md:104-118`、`packages/dsh-eval/README.md:112`、`packages/dsh-eval/src/index.ts:1-10`、`packages/dsh-eval/README.zh.md:61,85` 统一 judge 已实现/失败语义，删除互相矛盾的 deferred 表述。
- [ ] 更新 `research/evolution-plan.md` P0 标记与吸收来源；写任务 journal。
- [ ] 运行 Trellis check，分批提交；只有质量验证通过后执行 `/trellis:finish-work`、归档任务。

## Validation Commands

```powershell
# CJS controller/registry：逐文件单进程，避免 node --test spawn pipe 限制
node packages/evolution-controller/test/<file>.test.js
node packages/preset-registry/test/registry.test.js

# dsh-eval mirror 全流程
node packages/dsh-eval/scripts/prepare-sdk.mjs --dsh E:\github\dsh

# 真实评测（provider 由 benchmark 明确声明）
node E:\github\dsh\apps\cli\lib\bin.js --profile eval run <benchmark.yaml> --out <run.json> --split dev

# registry 备份恢复
node packages/evolution-controller/bin/dsh-evolve.js --registry <root> --export <package.json>
node packages/evolution-controller/bin/dsh-evolve.js --registry <empty-root> --import <package.json>
```

## Risk / Rollback Points

- P0-1：不改 judge prompt；无 judge 配置仍保持旧行为；provider 不可用时保存诊断，不填 0。
- P0-2：overfit 只拒绝候选，不删除 source/history；误报可关闭 metadata 入口但 frozen 优化不得静默绕过。
- P0-3：`frozen:false` 是兼容回滚点；invalid run 保留证据但不进入 gate。
- P0-4：不迁移 legacy digest；import 只允许空 root，失败不触碰已有 root。
- 任一验证门失败，停止后续阶段，保留前一阶段已提交的可回滚 commit。
