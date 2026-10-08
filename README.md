# pi-skill-tool

**把 pi 的 skill 面改成 Claude Code 式：目录一行一条，调用只有一个工具。**

pi 默认把 skill 列表硬编码成系统提示词里的 XML 块，每条带绝对路径，模型要用某个 skill 得自己去 read 文件。这个扩展换成更省的形态：系统提示词里 `- name: description` 一行一条，调用靠单个 `use_skill` 工具，正文直接进模型上下文。

|  | pi 默认 | pi-skill-tool |
|---|---|---|
| 目录 | `<available_skills>` XML，三行一条，暴露绝对路径 | `- name: description` 单行，无路径 |
| 调用 | 模型自己 read SKILL.md | `use_skill` 一步到位 |
| codemode 嵌套 | 结果只交给调用工具，不自动进入会话 | 经 steering 消息注入会话，主模型可见 |

## 安装

```sh
pi install git:github.com/toRolex/pi-skill-tool
```

装完即生效。如果你之前手动装过旧版 `~/.pi/agent/extensions/skill-tool.ts`，删掉它，否则同名工具会双注册。

## use_skill

```text
use_skill(skill: string, args?: string)
```

- **正文直达**。工具结果就是 SKILL.md 全文，模型不用再去读文件。
- **可选 `args`**。传了就在正文尾部追加 `Arguments: <args>` 一行，skill 正文自己声明怎么消费。
- **显式名称加载**。`disable-model-invocation: true` 的 skill 不出现在自动发现目录，但已知名称仍可通过 `use_skill` 加载。
- **错误是一行话**。不存在的名字返回 `Skill "x" not found.`，不倾倒可用列表。文件读取失败返回对应错误。

### codemode 里也能用

codemode 脚本内嵌套调用时，Pi 不自动把嵌套工具结果写入会话。扩展把正文经 steering 消息注入会话，嵌套结果仅返回确认信息。同一次调用不会同时通过两条路径交付正文：

```js
// codemode 脚本内
return await tools.use_skill({ skill: "grilling" })
// → 'Skill "grilling" loaded; full instructions delivered to the conversation.'
// 正文已作为 custom_message 进入会话，主模型下一轮就能引用
```

## 设计要点

- **数据只有一个来源**：`before_agent_start` 事件里的 `systemPromptOptions.skills`。不做任何文件扫描。`disable-model-invocation: true` 只影响自动发现目录，不阻止 `use_skill` 按名称加载。
- **显式加载语义**。Pi 原生通过 `/skill:name` 显式加载隐藏的 skill。本扩展也允许通过 `use_skill` 显式加载，不改变 Pi 的命令行为。
- **提示词覆写是段级的**：只替换 `<skills>…</skills>` 段，没有这个段就原样返回，不凭空注入。
- **缓存按会话隔离**：以 sessionManager 对象为键的 `WeakMap`，同 cwd 开多个会话互不覆盖。
- **嵌套调用靠 id 识别**：pi 的 `ctx.executeTool` 给嵌套调用的 id 是 `<calling id>/<n>`，据此区分交付路径。

## 兼容性

- 初始安装实测 pi 1.0.2。本次注册工具回归测试使用 pi 1.1.0，通过 `pi.extensions` 声明入口。
- peerDependencies 只声明 host 供给的 `typebox` 与 `@earendil-works/pi-coding-agent`，git 安装无 vendored 断链风险。

## 验证

已安装 Pi 且 `pi` 在 PATH 中时，运行 `npm test`。测试也可直接解析本地安装的 `@earendil-works/pi-coding-agent`。

测试通过 Pi 的扩展加载器注册真实 `use_skill` 工具，验证显式加载、目录过滤、错误结果、会话隔离与嵌套调用的正文交付。不需要模型请求。

## 相关

- [`reference/skill-tool-legacy.ts`](reference/skill-tool-legacy.ts) 和早期 `.agents/notes/` 保留旧行为的历史记录，包括拒绝加载 user-only skill。当前行为以 `src/extension.ts`、本 README 和回归测试为准。
- 架构参照 Claude Code 的 Skill 工具与 [@luan.sh/pi-skills](https://github.com/luan/agents/blob/main/harnesses/pi/agent/packages/pi-skills/README.md)。
