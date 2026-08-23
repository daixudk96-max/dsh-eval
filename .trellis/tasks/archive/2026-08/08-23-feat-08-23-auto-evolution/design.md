# 自动进化闭环 — Design

## 1. 目标形态

```
dsh-evolve --auto --benchmark <yaml> --registry <root> --logical <id> [--approve <id>]
    │
    ├─ 评测 baseline(split=dev)           ← spawn dsh --profile eval run
    ├─ proposer(LLM): 失败簇+证据 → hypothesis/evidence/mutations/candidateFiles
    │      └─ 证据先 redact → prompt(含 run.json 失败 case + 当前 revision 内容摘要)
    ├─ proposal-check 门槛(不过则拒绝, 不 bypass)
    ├─ createCandidate+seal → 评测 candidate
    ├─ Code Gate → ACCEPTED+approval → promote | 拒绝(exit 1)
```

## 2. proposer.js 接口(CJS 零依赖)

```js
// packages/evolution-controller/lib/proposer.js
async function propose({ runJson, baselineFiles, logicalId, llm, redactValues = [] })
// → { hypothesis, evidence[], mutations[], candidateFiles } 或 throw
//   llm: { complete(messages) → string } 注入(fake 或真实 clipa 客户端)
```

- `evidence[]` = run.json 失败 case 摘要(经 redact)+ 失败簇标签
- `mutations` = 描述性数组(不执行, 审计用)
- `candidateFiles` = 变异后的 {relPath: text}(LLM 返回 JSON, 校验为文件映射)
- LLM prompt: system(你是进化提案者, 输出严格 JSON {hypothesis, evidence, mutations, files})+
  user(benchmark 名、失败 case 列表、当前 revision 内容(截断)、失败簇)
- 失败处理: LLM 返回非 JSON / files 缺失 → 返回 {ok:false, reason}

## 3. LLM 客户端(llm-client.js, 可复用)

- `createClipaClient({ baseUrl='http://127.0.0.1:8317/v1', apiKey, model='deepseek-v4-flash' })`
  → `{ complete(system, user) → string }`
- 凭证: env 优先, 否则读 ~/.dsh/.credentials.yaml(逐行 split, 同 rubric-score.mjs)
- 用 fetch(node 22 内建); 零依赖
- 放 evolution-controller/lib/llm-client.js(CLI 用); proposer 接受注入的 llm, 不直接依赖网络

## 4. dsh-evolve.js 增 --auto

- 无 --candidate 且 --auto: 调 propose({run: baselineRun, baselineFiles: current 内容, ...})
- 输出 proposer 生成的 hypothesis/evidence 到 --out/proposal.json
- 不过门槛 → 打印拒绝原因, exit 1(不伪造)
- 保留现有 --candidate 路径(手工变异仍可用)

## 5. B 评测集

- refactor-rename: workspace fixtures/rename-me(src/helper.js + test), 任务: 重命名函数+跑测试
  split: dev; check: node check.js
- readme-write: workspace fixtures/readme-me(小项目), 任务: 读代码写 README.md 含关键术语
  split: guard; check: node check.js(关键词 grep)
- 两个都 provider: clipa, 与 fix-multiply 同 schema

## 6. C 系统 preset 治理

- 初始安装脚本 research/install-system-presets.mjs(registry 真实 root):
  system-evaluator ← packages/system-presets/presets/system-evaluator/** (preset.yml+agent.cordis.yml)
  system-evolver ← 同
- 与 evaluate 初始安装同流程(expectedCurrent: null, gateRunId/approvalId = install-*)

## 7. 验证顺序

1. proposer 单测(fake llm, 3 用例: 正常/缺证据/非 JSON)
2. dsh-evolve --auto 真实一轮(拒绝路径先行, 再 --approve)
3. B benchmark 真实跑(dev+guard)
4. C 安装 + resolveCurrent
5. D 收尾
