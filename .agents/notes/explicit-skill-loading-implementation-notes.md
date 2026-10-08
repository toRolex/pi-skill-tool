# 显式 skill 加载修正

## 目标与数据形状

保持 `SkillInfo[]` 与按 sessionManager 隔离的 WeakMap。完整目录用于按名称加载，过滤后的目录仅用于自动发现。不给 skill 新增状态，不扫描额外目录。

## Bug fix 清单

1. Reproduce it yourself on the matching surface via the control skill (Non-negotiables), even when a debug or instrumentation protocol says to ask the user to reproduce. Ask the user only with a stated, specific reason the control surface cannot reach the target, and only after driving it as far as it goes. If it won't reproduce directly, synthesize the trigger, tighten conditions, or instrument until it fires.
2. Binary-search the cause. Form the candidate hypotheses, then rule them out until one survives. Seed them with `how` over the affected subsystem and the **why** skill for regression history. Each pass, take the split that cuts the most remaining problem space, get runtime evidence, eliminate. When program state is unclear, add instrumentation or logging and read it as the code runs. Don't guess. Drive a long or stubborn hunt with Cursor's `/loop` command. Confirm the surviving *mechanism* with runtime evidence before the step-3 architect/interrogate fan-out.
3. Plan the fix. If it crosses a function boundary, `architect` first. Delegate implementation to a subagent using your configured bug-fix model (default `grok-4.7-xhigh-fast`) with a specific scope.
4. Verify on the same surface. The original repro now passes. "Inconclusive" or wrong-surface is not a pass. Flag it. Unit tests show branch behavior, not bug absence.
5. Stage the commits so the failing repro lands before the fix in git history. See the **tdd** skill for the failing-test-first cadence when the bug has a cheap local test path. Skip it when the test would be expensive, integration-heavy, or unclear.
   This is the canonical **sequence-verifiable-units** principle skill, the failing test first and the fix on top.
   原轮 skip: 用户要求不提交，保留本地先失败后通过的测试证据。当前发布请求已授权提交、推送和创建 PR，使用单个可通过验证的修复提交。
6. Run **Opening a PR**.
   原轮 skip: 用户明确不需要 PR。当前发布请求覆盖此边界，执行 Opening a PR。

## 吞吐检查点与分工

串行门为核实字段语义、观察原测试失败、最小修复、重新运行。文档调查与代码测试分别交给独立子代理。文档调查只读，代码代理仅写 src/extension.ts、tests/extension.test.mjs、package.json，主代理写 README 与本 notes。使用用户指定的 sol，不使用本周不可用的 grok 或 kimi。完成条件为显式加载成功、目录继续隐藏、已有错误与 nested 交付行为通过同一套可重跑测试。

## 已观察证据

- 当前会话 `use_skill("poteto-mode")` 返回 `Skill "poteto-mode" is user-only (disable-model-invocation); ask the user to invoke it via /skill:poteto-mode.`。
- Pi 1.1.0 `docs/skills.md` 同时说仅显式命令可用，以及该字段隐藏自动模型选择。此次需求明确让本扩展的显式 `use_skill` 也可加载，不修改 Pi 自身 `/skill:name`。
- 已全文读取 Pi 1.1.0 docs/skills.md、docs/extensions.md、docs/packages.md。extensions 文档确认 nested id 为 `<parent id>/<n>`，nested 返回本身不进入 transcript。

## 文档与风险核对

- 独立只读调查核实 `dist/core/agent-session.js:1279-1284` 将全量 loaded skills 放入 prompt options，`dist/core/skills.js:272-279` 才过滤目录。明确区分发现与读取可用性。
- README 更新当前语义与回归测试入口。reference/skill-tool-legacy.ts 与既有 spec、notes 不重写，保留历史实现，README 明确其旧拒绝策略不代表当前行为。
- `docs/extensions.md:148` 保证 nested id 含 `/`，未保证所有 direct id 不含 `/`。保留现有识别方式，本次不扩展修复。
- nested 工具返回不自动写入 transcript，不等于调用者永远无法输出正文。README 将绝对丢失说法改为自动交付规则。

## 验证结果

- 实现代理先在原生产代码运行同一套测试，输出已读取核对。

```text
not ok 1 - disabled skill loads directly by explicit name with arguments
    +       text: 'Skill "disabled" is user-only (disable-model-invocation); ask the user to invoke it via /skill:disabled.',
# tests 11
# pass 7
# fail 4
```

- 主代理独立运行 `npm test`，Pi 1.1.0 的 loadExtensions 注册当前生产扩展，ExtensionRunner 分发 before_agent_start 并取得实际注册工具 execute。11 项通过，0 失败。测试不复制 production helper。
- `node --check tests/extension.test.mjs` 退出码 0。主动 LSP 检查 src/extension.ts 与 tests/extension.test.mjs，2 文件 clean，0 diagnostics。
- nested 测试使用官方 ID 格式调用注册工具，观察真实 runtime sendMessage 绑定的 payload。没有运行完整 codemode 或模型请求，不能声称已测全链路模型读取。
- 不需要单独编译步骤。Pi 用 jiti 加载 TypeScript，测试已通过宿主实际加载路径。
- 测试使用 host 内部 dist loader/runtime，宿主升级后可能需要更新初始化。支持本地 package、PATH CLI symlink 与 pnpm shim，不含本机绝对安装路径。
- 注释审查未发现本次新增注释违规，删除 0，恢复 0，无待批准编码。
- 独立 code-reviewer 验收 PASS，再运行 npm test 为 11/11，通过目录隐藏、完整显式加载、错误、会话与 nested 交付断言。最终 guideline 将目录说明改为 automatic discovery，不再把目录范围混同可加载范围。主代理随后再次运行 npm test，仍 11/11。

## Deviations

- 当前安装的 `use_skill` 拒绝加载 user-only 的流程与原则 skill。尝试工具得到明确拒绝后，按用户显式提供的本任务要求读取对应 SKILL.md 全文。此限制正是本任务要纠正的代码行为，不额外修改全局 skill 或创建 PR。
- 无函数边界变化，不引入 architect 原型或新 production API。
- 原修复轮不查询版本控制历史。发布轮读取基线提交，在隔离临时目录运行原版扩展与当前测试，不扰动当前 checkout。

## 发布轮验证

- 首次 jj snapshot 前未发现仓库内敏感文件。`git check-ignore` 确认 node_modules 下的 .env 与 .pem 路径被忽略。待发布文件未发现真实密钥。
- 执行 `jj git init --colocate`。Git 与 jj 姓名及邮箱均为 rolex 与 torolex@163.com，待提交作者一致。
- 隔离目录使用基线 f2c8f8d8 的 src/extension.ts 与当前测试重新复现，`npm test` 为 7 pass、4 fail，退出码 1。
- 当前 checkout 重新执行 `npm test` 为 11 pass、0 fail。`node --check tests/extension.test.mjs` 退出码 0。
- `gh repo view` 确认 toRolex/pi-skill-tool，非 fork，默认 base 为 main。使用用户指定的 gh，不合并、不 npm 发布、不 force push。
- 未安装 deslop，按 Harness 回退逐项复读差异。仅发布本次五个文件，保留既有注释与历史文件。
- 三模型独立审查发现本地安装测试解析使用 CJS，遇到宿主 import-only exports 会失败。改用 `import.meta.resolve` 与 `ERR_MODULE_NOT_FOUND` 回退。当前 PATH 路径及隔离目录本地宿主 symlink 路径均重新执行 `npm test`，各 11 pass、0 fail。
- 采纳本地安装解析缺陷。宿主 before_agent_start 载荷前提经源码核对成立，但测试不覆盖完整 AgentSession，登记为兼容性风险。未采纳 promptGuidelines 的用户点名限制建议，该限制不属于本次目标。低影响文案断言、测试 options 去重建议不扩展范围。
- 新一轮注释审查取得固定 diff 后确认可执行发现 0，删除 0，恢复 0，无编码或待批准项。
