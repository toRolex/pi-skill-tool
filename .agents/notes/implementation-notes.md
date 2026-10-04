# pi-skill-tool 实现过程 notes

开工 spec：`.agents/notes/implementation-spec.md`（全部 decision 已锁定，此处只记过程决策与 Deviations）。

## API 锚点核实（pi 1.0.2，dist）

- `BeforeAgentStartEventResult.systemPrompt`（types.d.ts:1088-1091）：返回即整体覆写本轮 system prompt，后续 handler 观察到覆写值。链式替换可行。
- `<skills>` 段结构：`buildSystemPromptSections`（system-prompt.js:97-129）给每段包 `<name>\ncontent\n</name>`；skills 段内容来自 `formatSkillsForPrompt`（skills.js:275-296），XML 每条含 name/description/location。替换正则按 `/<skills>[\s\S]*?<\/skills>/` 段级整块替换。
- `ctx.sendMessage`（agent-session.js:3519 注入到 context，sendCustomMessage 1746-1782）：custom message 在 LLM 上下文中转成 user role 文本（messages.js:89-98），`display` 只影响 UI。streaming 中默认走 `agent.steer()`（即 luan B 的 steering message 方案）。
- 嵌套调用识别：`ExtensionToolContext.executeTool` 的 call id 是 `<calling id>/<n>`（types.d.ts:274-280 注释），直接调用的模型侧 id 不含 `/`。`toolCallId.includes("/")` 即嵌套。
- 会话隔离缓存：before_agent_start 与 tool execute 的 `ctx.sessionManager` 都指向 ExtensionRunner 的同一实例（runner.js:634-636），session 切换换 runner/sessionManager 实例。用 `WeakMap<object, SkillInfo[]>` 以 sessionManager 对象为 key，天然随 session 生灭，替代旧的 `Map<cwd, skills>`。

## Deviations

1. `package.json` 的 `"main": "src/extension.ts"` 不会被 pi package 发现：git 安装后扩展未加载（实测 `pi -p` 会话 toolsAdded 无 use_skill）。pi 的发现走 `pi.extensions` 路径数组（对照 `pi-tool-search/package.json`）。已改为 `pi.extensions: ["./src/extension.ts"]` 并保留 main。

2. Feature playbook 的 subagent 委托未走：单文件 + spec 全锁定 + API 锚点已核实，实现由主线完成；review 分离改由 review-only 模型（gpt-6.1-sol）对 diff 的独立审查承担。

## 验证记录（2026-10-04，全部实测）

- 安装：`pi install git:github.com/toRolex/pi-skill-tool` 后 `use_skill` 在列、`list_skills` 消失（session toolsAdded）。
- 目录覆写：probe 扩展挂 `before_provider_request` 抓真实 payload，`<skills>` 段为单行 `- name: description`，无 `<available_skills>`、无 `<location>`、user-only 不出现。
- 正反用例：存在 skill 正文进工具结果且尾部有 `Arguments: potato`；不存在 → 一行 `not found` error；user-only → 一行 error 指向 `/skill:name`。
- codemode 嵌套：嵌套 id 含 `/` 走 steering，session 出现 `custom_message`（customType skill_body，display false），主模型最终回复引用正文原句；直接调用不受影响（双份去重成立）。
- 测试 fixture `~/.pi/agent/skills/test-user-only` 已删除。
