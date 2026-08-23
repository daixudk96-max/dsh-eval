# P3 治理: 审查脱敏 + 进化命令面 — Design

## 1. 架构决策

```
进化命令(evolution-controller/bin/dsh-evolve.js, CJS, node 直接跑)
    │  spawn(评测只读域)              require(进化只写域)
    ▼                                   ▼
dsh --profile eval run <benchmark>    Registry + EvolutionController
(baseline.json / candidate.json)      (seal/gate/promote/审计)
```

- **评测与进化进程分离**: 评测仍走 `dsh --profile eval run`(dsh-eval 打包版, 不嵌套依赖),
  进化走 evolution-controller 库。信任域在进程边界分开, 无需把两个包打进同一 bundle。
- **入口**: `node packages/evolution-controller/bin/dsh-evolve.js ...`(零依赖 CJS)。
  后续要挂 `dsh --profile eval evolve` 只是加一个转发子命令, 本任务先交付独立 CLI。
- **脱敏位置**: controller.createCandidate 内部统一先 redact 再审计/存储 —— 任何调用方都脱敏。

## 2. redact.js(新增, CJS)

照 lmzhen redact.ts 的 8 个 SECRET_PATTERNS 改写 + 扩展:
- `redactSecrets(text)`: openai key `sk-[A-Za-z0-9_-]{16,}` / aws `AKIA[0-9A-Z]{16}` /
  github `gh[pousr]_[A-Za-z0-9]{20,}` / gitlab `glpat-` / slack `xox[baprs]-` /
  jwt `eyJ…` / `Bearer …` / inline 赋值 `(token|api_key|secret|password|passwd)[:=] "…"`
- `redactCredentials(text, values[])`: 显式凭证值(env/credential 值, len>0)替换为 `<redacted:credential>`
- `redactPaths(text)`: 盘符绝对路径 `[A-Za-z]:\\…`、UNC `\\\\…`、`~` 家目录 → `<redacted:path>`
- `redactSessionIds(text)`: `session-<32hex>` 形 → `<redacted:session>`
- `redactReviewText(text, {values})` = 四者合一

## 3. controller.js 集成

- createCandidate: `evidence` 数组与 hypothesis 在 `_audit`/run 存储前
  `redactReviewText(join, {values})`; 审计与 run 对象都存脱敏后文本。
- `values` 来源: `constructor` 可选 `redactValues: string[]`(调用方从 credentials 读),
  默认空 = 仅形状脱敏(密钥形状/路径/session id 仍脱敏)。

## 4. bin/dsh-evolve.js(新增, CJS CLI)

参数(`--key value` 与 `--key=value` 均支持):
```
--benchmark <yaml>     必填: 评测基准(双跑同一基准)
--registry <root>      必填: preset-registry 根
--logical <id>         必填: logical preset id
--candidate <dir>      可选: 候选内容目录(变异后文件); 缺省 = 读 current 内容
--split <dev|guard>    默认 dev
--approve <approvalId> 可选: 人审绑定; 缺省 = 演示拒绝
--min-effect <n>       默认 0.05
--dsh <launcher>       默认 node E:\github\dsh\apps\cli\lib\bin.js
--out <dir>            默认 ./evolve-out, 写 baseline.json/candidate.json/gate.json/result.json
```

闭环步骤:
1. `resolveCurrent` → 读 current 内容文件(源)
2. 候选 = `--candidate` 目录内容(文件存在性校验); 缺省 = mutate 占位(追加 `## Evolution note` 到 persona, 保证有真实差异)
3. proposal-check(复用 controller.createCandidate 内建)
4. seal → 评测 baseline(先跑)→ 评测 candidate(`dsh --profile eval run --split dev`)
5. evaluate(真实 grading → baseline/candidate 四分量 + steps 效率)
6. 结果: ACCEPTED + --approve → promote + 导出到 --out; 否则拒绝原因 + 退出码 1

评测运行用 `spawnSync`(inherit 输出),超时 600s; 失败 = 无证据不 promote。

## 5. 测试与验证

- redact.test.js: 9 例(8 形状 + 路径/session/已知值 + 组合)
- controller-redact.test.js: createCandidate 审计不残留原凭证
- 真实: dsh-evolve.js 无 --approve 一轮(拒绝) + --approve 一轮(promote, 用
  evaluate-preset-p2 小样本, 或直接跑 fix-multiply-short 双面)
- 全量回归: evolution-controller node:test + dsh-eval vitest(evolve 不引入新依赖, 无需重建 dist)
