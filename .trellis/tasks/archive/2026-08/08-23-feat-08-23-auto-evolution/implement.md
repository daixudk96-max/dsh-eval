# 自动进化闭环 — Implement

## A. proposer
- [ ] lib/llm-client.js: createClipaClient(凭证 env→.credentials.yaml, fetch, complete(system,user))
- [ ] lib/proposer.js: propose({runJson,baselineFiles,logicalId,llm,redactValues})
      → {hypothesis,evidence,mutations,candidateFiles} | {ok:false,reason}; 失败簇提取; redact 先行
- [ ] bin/dsh-evolve.js: --auto 分支(无 --candidate 时调 proposer, proposal.json 产物)
- [ ] test/proposer.test.js(fake llm: 正常/缺证据/非 JSON/redact 生效)
- [ ] 全量 node:test 回归

## A-真实
- [ ] dsh-evolve --auto 无 --approve 一轮(拒绝路径, 观察 proposer 输出质量)
- [ ] dsh-evolve --auto --approve 一轮(promote 或诚实拒绝)

## B-评测集
- [ ] eval/benchmarks/fixtures/rename-me/(src/helper.js + test + check.js)
- [ ] refactor-rename-benchmark.yaml(split: dev)
- [ ] eval/benchmarks/fixtures/readme-me/(小项目 + check.js)
- [ ] readme-write-benchmark.yaml(split: guard)
- [ ] 真实跑 dev+guard, run.json 归档

## C-系统 preset 治理
- [ ] research/install-system-presets.mjs(初始安装 system-evaluator/system-evolver, expectedCurrent:null)
- [ ] 真实 registry resolveCurrent ×2 验证

## D-收尾
- [ ] 全量回归(dsh-eval vitest + evolution-controller node:test)
- [ ] 清理 run-short*/probe* 历史产物(归档 research/archive/)
- [ ] evolution-plan.md 勾选; git 分批提交; task archive + journal
