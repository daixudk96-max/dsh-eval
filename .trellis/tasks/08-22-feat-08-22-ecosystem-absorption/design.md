# 设计文档 —— 生态基座吸收与 rubric 两层判定

> 对应 prd.md;权威吸收清单见 research/evolution-plan.md(§2 同语言 / §3 拆模块)。
> 本文只写技术设计: 边界、契约、数据流、权衡、兼容性。

## 1. 模块边界与契约

```
packages/
├── dsh-eval/lib/                # 评测引擎(同语言基座, 直接改)
│   ├── judge.js                 # 增量: 接 rubric 文本(钩子已存在 judge.ts:81)
│   ├── rubric.js               # 新增: AES-256-GCM 加密信封 + 密钥解析(照 continual-evolve/src/rubric.ts)
│   ├── benchmark.js            # 增量: schema 支持 judge.rubricText / judge.rubricCipher; split 字段
│   ├── runner.js               # 增量: fail-closed gradeTrial
│   └── types.js                # 增量: BenchmarkJudge.rubricText?/rubricCipher?; BenchmarkCase.split?
├── evolution-controller/lib/   # 进化治理(改写吸收)
│   ├── gate.js          # 增量: rubricScore/rubricMinScore/rubricRegressions 判定
│   ├── aggregate.js     # 新增: 照 score.ts 聚合(失败 cell 排除)
│   ├── controller.js    # 增量: evaluate() 透传 rubric
│   ├── budget.js        # 新增(P2): budget ledger(照 self-evolving budget/ledger.ts)
│   └── proposer.js      # 新增(P2): 失败证据→多假设候选
└── preset-registry/lib/        # 版本化(自研, 印证)
    ├── registry.js      # 增量(P2): promote 近重复检测(照 continual-evolve promotion.ts)
    └── ...
```

依赖方向不变: controller → registry; 评测证据(只读)由 dsh-eval 产出。

## 2. rubric 数据流(P0)

```
benchmark.yaml
  judge:
    rubricText: "..."      # 明文输入(人工)
    # 或 rubricCipher: "v1:<iv|tag|data>"   # 加密存储(ACL)
        │
        ▼
dsh-eval: benchmark.js 解析 → rubric.js decryptRubric(照 rubric.ts:109)
        │
        ▼
judge.js buildJudgePrompt(): system += ['Rubric:', rubric]   # 钩子已存在
        │  LLM judge 产 per-cell: { finalAnswerScore, hallucination, rationale }
        ▼
evolution-controller: aggregate.js(照 score.ts:43)
        │  失败 cell 排除于均值; case 均值; overall; failed/total
        ▼
gate.js evaluateGate({ baseline, candidate, rubricScore, rubricMinScore, rubricRegressions })
        │  新增规则:
        │   rubricScore < rubricMinScore        → FAIL(质量不达标)
        │   rubric 逐维 candidate < baseline     → FAIL(质量回归)
        │   (确定性规则不变: digest/epoch/gain/回归/canary/holdout)
        ▼
PASS → promote(approvalId 强制) → ledger 记录 rubric 证据
```

### 密钥解析(照 rubric.ts:53 resolveRubricKey, 4 级)
1. plugin config `rubricKey`
2. env `DSH_EVOLVE_RUBRIC_KEY`
3. `<baseDir>/evolve/rubric.key`(自动生成, 0600)
4. 固定 dev key(仅异常环境, 告警)

### 加密信封(照 rubric.ts:96)
`v1:<base64url(iv)>|<base64url(tag)>|<base64url(ciphertext)>`, AES-256-GCM,
key = sha256(passphrase)。无 `v1:` 前缀视为旧明文透传(兼容)。

## 3. aggregate 协议(照 score.ts)

- 输入: `{ caseId, score, status: 'ok'|'failed', durationMs? }[]`
- 失败 cell **排除**于均值(绝不当作 0 拉低整体); 全失败 case 报 null
- 输出: `{ overall, perCase: {id: mean}, failed, total, totalDurationMs }`
- 默认 passThreshold 60 / regressionTolerance 0 / maxFailedCells 0(任何失败拒绝该轮)——移植为 gate 参数

## 4. 状态机不变

DRAFT→SEALED→EVALUATING→ACCEPTED→PROMOTED; EVALUATING↘REJECTED|INCONCLUSIVE(→EVALUATING)|INVALID。
rubric FAIL → REJECTED; rubric 不足 minEffect 语义 → INCONCLUSIVE。promote 仍强制 approvalId。

## 5. 权衡

| 取舍 | 选择 | 理由 |
|---|---|---|
| rubric 明文 vs 加密 | 双支持, 加密推荐 | ACL 防模型偷看评分标准(照 continual-evolve) |
| 聚合放评测侧 vs 控制器侧 | 控制器侧(aggregate.js) | 控制器拥有接受/拒绝决策, 评测只产原始分 |
| LLM 打分 vs 确定性判定 | 两者都要 | 确定性防伪造, rubric 评质量; 用户定稿「两层都过」 |
| TS 模块改 vs 改写 | 改写(CJS) | 零依赖约束; 逻辑同构照搬, 不背 TS 工具链 |

## 6. 风险

- **rubric 打分不稳定**: temperature 0 + strict JSON 解析(已有 judge.js); 失败 cell 协议防拖均值。
- **评测引擎受限**: 模型不可用时 rubric 层无输入 → gate 需如实 INCONCLUSIVE, 不伪造。
- **近重复检测( prom-2)**: 保守实现(规范化文本 + 相似度阈值), 不阻断合法重复语义。
