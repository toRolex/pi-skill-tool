# pi-skill-tool 实现过程 notes

开工 spec：`.agents/notes/implementation-spec.md`（全部 decision 已锁定，此处只记过程决策与 Deviations）。

## API 锚点核实（pi 1.0.2，dist）

- `BeforeAgentStartEventResult.systemPrompt`（types.d.ts:1088-1091）：返回即整体覆写本轮 system prompt，后续 handler 观察到覆写值。链式替换可行。
- `<skills>` 段结构：`buildSystemPromptSections`（system-prompt.js:97-129）给每段包 `<name>\ncontent\n</name>`；skills 段内容来自 `formatSkillsForPrompt`（skills.js:275-296），XML 每条含 name/description/location。替换正则按 `/<skills>[\s\S]*?<\/skills>/` 段级整块替换。
- `ctx.sendMessage`（agent-session.js:3519 注入到 context，sendCustomMessage 1746-1782）：custom message 在 LLM 上下文中转成 user role 文本（messages.js:89-98），`display` 只影响 UI。streaming 中默认走 `agent.steer()`（即 luan B 的 steering message 方案）。
- 嵌套调用识别：`ExtensionToolContext.executeTool` 的 call id 是 `<calling id>/<n>`（types.d.ts:274-280 注释），直接调用的模型侧 id 不含 `/`。`toolCallId.includes("/")` 即嵌套。
- 会话隔离缓存：before_agent_start 与 tool execute 的 `ctx.sessionManager` 都指向 ExtensionRunner 的同一实例（runner.js:634-636），session 切换换 runner/sessionManager 实例。用 `WeakMap<object, SkillInfo[]>` 以 sessionManager 对象为 key，天然随 session 生灭，替代旧的 `Map<cwd, skills>`。

## Deviations

（空）
