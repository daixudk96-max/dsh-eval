# P3-4 热挂载验证结论

**结论: FEASIBLE — SKILL.md → live skill, 零组合改动, 无需重启。**

验证日期: 2026-08-23(隔离 DSH_HOME, 未触碰任何真实 harness 组合)

## 验证方式

`packages/evolution-controller/demo/hot-mount-verification.js`(129 行)在临时目录构造隔离
`$DSH_HOME`, 用 harness 自带、未改动的 `@deepseek-ai/dsh-skill-filesystem` 提供方
(`E:/github/dsh/packages/skill/skill-filesystem/lib/index.js` 的 `FileSystemSkillProvider`,
经 `pathToFileURL` 导入, 仅 duck-typed stub ctx)验证:

1. 用真实 P3-1 generator 渲染 SKILL.md, 落到 `<home>/skills/<kebab-name>/SKILL.md`;
2. `provider.list()` → 候选出现, source root = `user-dsh`;
3. `get()` → name/description/body 全部载入, 内容 = P3-1 产物;
4. 再丢第二个 skill → 重新 list 立即可见(热新增, 无重启)。

## 运行输出要点

- 文件名派生: `summarize-readme-files-into-a-report.md`(kebab-case)
- SKILL.md 1005 字符, `$DSH_HOME/skills/summarize-readme-files-into-a-report/SKILL.md`
- verdict: `FEASIBLE: SKILL.md → live skill via the native filesystem provider;
  zero composition changes; discoverable without restart.`

## 对产品的影响

- 原生热挂载路径 = `$DSH_HOME/skills/<name>/SKILL.md`(一层深), `skill` 工具可直接调用;
- 无需 Cordis 插件行 / composition 变更 / 重启——P3-1 提炼产物可直接进入运行时;
- 未集成到任何 live harness(本验证只读提供方, 不加载未知来源, 符合 design.md 最低交付)。

## 备注

- P3-1 提炼产物的「注入形态」与 P3-6 ranked injection 是两条独立路径:
  前者走 `skills/` 目录热挂载, 后者是轻量 prompt notes(≤6/kind×180 字符)。
