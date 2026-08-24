# implement — P1 命令面补全(cmd-surface)

## P1-1 registry.decodeFileId + 测试
- `packages/preset-registry/lib/registry.js`:`_safeFileId` 旁加公开 `decodeFileId(encodedId)`,逆替换(`%25`→`%`、`%3A`→`:`,顺序:先 %25 后 %3A,避免 `%3A25` 类误替换)。
- `packages/preset-registry/test/registry.test.js`:新增用例 — `decodeFileId(_safeFileId(id)) === id` 往返(`evaluate`、`state:prompt:style`、含 `%` 的 id);解码非编码字符串原样返回。

## P1-2 printStatus 解码修复
- `packages/evolution-controller/bin/dsh-evolve.js` printStatus:logicalIds 映射 `registry.decodeFileId(name.replace(/\.json$/,''))`,去重后排序;resolveCurrent/history 用解码 id。打印时显示解码后 id。

## P1-3 --budget-dir/--budget-limit 参数
- dsh-evolve.js:usage() 增两参数说明;main() 解析;两者齐备 → `new EvolutionController({ registry, auditDir, budget: { dir, limitUsd } })`;单侧 → console.warn 提示需齐备;超预算错误自然从 controller.newRun 抛出 → main().catch 已处理 exit 1。
- 闭环/归档/状态模式互斥列表:--budget-dir/--budget-limit 属闭环参数(归档/状态模式不兼容,加入 incompatible 列表)。

## P1-4 验证
- `node test/registry.test.js` + evolution-controller 全量单进程测试全绿。
- 真实:`--status --registry C:/Users/daixu/.dsh/preset-registry` 输出 evaluate 链(active c4d8aec0 等)无假 id;`--budget-dir <tmp> --budget-limit 0` 闭环(临时 logical,用最小 benchmark 或直接到 newRun 即被拒)确认 exhausted 消息 + exit 1。
- 提交 + task.py archive + journal 追加。
