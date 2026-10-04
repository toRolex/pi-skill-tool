# pi-skill-tool 实现规格（grilling session 已锁定，2026-10-04）

本文件是开工 spec，不是过程记录。全部 decision 已与用户确认，实现细节（正则边界、类型、去重）由实现者自行判断。

## 背景

用户现有自写扩展 `~/.pi/agent/extensions/skill-tool.ts`（252 行，单文件）：
注册 `use_skill` + `list_skills` 两个工具，目录消费 pi 权威 skill 数据
（`before_agent_start` 的 `event.systemPromptOptions.skills`，字段：name /
description / filePath / baseDir / sourceInfo / disableModelInvocation，
见 `dist/core/skills.d.ts:11-19`）。

对照对象：`@luan.sh/pi-skills`（README 快照曾存于 /tmp/pi-skills-README.md，
源码未审）。Claude Code 的 Skill 工具为架构参照：发现靠系统提示词里的一行式
目录（`- name: description`），调用靠单工具 + 可选 args，无 list 工具、无
占位工具、无 UI 生态。

## 已锁定的 decision

### 1. 目录瘦身（放扩展本体）

- `before_agent_start` 中对 `event.systemPrompt` 做段落替换：删掉 pi 硬编码的
  `<available_skills>...</available_skills>` XML 段（生成代码
  `dist/core/skills.js:275-296 formatSkillsForPrompt`，无任何配置项可改），
  用 `systemPromptOptions.skills` 重建为 CC 式 `- name: description` 单行列表。
- 彻底去掉 `location` 绝对路径。user-only（disableModelInvocation）维持不进目录。
- 无该 section 时原样返回，不注入。数据源是权威的 systemPromptOptions.skills，
  不做任何文件扫描。

### 2. 工具面

- **删 `list_skills`**。发现全靠目录，调用靠 `use_skill`。
- `use_skill` 加可选 `args: string`：有传参时在加载结果里追加
  `Arguments: <args>` 行，skill 正文自行声明消费方式。

### 3. 四修（全部纳入）

1. **codemode 嵌套调用正文交付**：直接调用的正文走工具结果（现状保留）；
   需要保证嵌套调用（codemode 内 `tools.use_skill`）时正文进入主模型上下文，
   参考 luan B 的 steering message 方案（自定义消息类型注入会话历史）。
   注意与直接调用去重，避免正文双份。
2. **删 fallback 扫描**（现 skill-tool.ts L86-135 的 scanSkillDirs 一族）：
   拿不到权威目录就明确失败。现 fallback 绕过项目信任边界、发现逻辑与 pi
   不等价、正则假 YAML，全部不要。
3. **缓存按 session 隔离**：现 `Map<cwd, skills>`（L35-42）在同 cwd 多会话
   下互相覆盖。
4. **失败语义**：未知 skill 名返回 error 结果，信息一行，不倾倒全部可用目录。

### 4. 仓库化

- 本仓库，public，main 分支。正式 pi package：`package.json` 已就位，
  peerDependencies 只声明 host 供给的 `typebox` 与 `@earendil-works/pi-coding-agent`。
- 安装：`pi install git:github.com/toRolex/pi-skill-tool`，一步到位（无 vendored
  断链风险，参照 pi-tool-search 的教训）。
- **装完必须删 `~/.pi/agent/extensions/skill-tool.ts`**，否则同名工具双注册。
- 验证：`pi -p` 确认 use_skill 在列、list_skills 消失、系统提示词目录为
  单行格式且无 location；skill 加载正反用例（存在 / 不存在 / user-only /
  args 传参 / codemode 嵌套调用后主模型能看到正文）。

## 参照素材

- 旧实现全文：`~/.pi/agent/extensions/skill-tool.ts`（git 历史之外唯一来源，
  迁移后删除前先拷贝进本仓库作参照）。
- luan B 的 README：https://github.com/luan/agents/blob/main/harnesses/pi/agent/packages/pi-skills/README.md
- pi API 锚点（已核实）：
  - `before_agent_start` 返回 `{ systemPrompt }` 链式整体覆写：
    `types.d.ts:845-849`、`runner.js:881-901`、`agent-session.js:915,931-933`、
    `docs/extensions.md:530-565`
  - `ctx.getSystemPrompt()` / `ctx.getSystemPromptOptions()`：`docs/extensions.md:1093-1124`
  - `<available_skills>` 生成：`dist/core/skills.js:275-296`，调用点
    `dist/core/system-prompt.js:30,114`
