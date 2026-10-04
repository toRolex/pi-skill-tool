// pi-skill-tool: CC-style skill surface for pi.
//
// Discovery lives in the system prompt as a one-line catalogue
// (`- name: description`); invocation lives in a single `use_skill` tool.
// There is no list tool, no fallback scanning, no absolute paths in the prompt.
//
// The catalogue replaces pi's hardcoded `<available_skills>` XML block in
// `before_agent_start`. Skill data comes only from the authoritative
// `event.systemPromptOptions.skills`; if pi rendered no skills section, the
// prompt is returned untouched.
//
// Nested calls (e.g. `tools.use_skill` inside a codemode script) never reach
// the model as a tool result, so the body is delivered as a steered custom
// message instead. Direct calls return the body in the tool result; the two
// paths never both carry the body.

import * as fs from "node:fs";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type SkillInfo = {
  name: string;
  description: string;
  filePath: string;
  disableModelInvocation: boolean;
};

// Per-session catalogue captured from the authoritative before_agent_start
// data. Keyed by the session's sessionManager object (one instance per
// session), so same-cwd sessions never overwrite each other.
const catalogueBySession = new WeakMap<object, SkillInfo[]>();

function normalizeSkills(raw: unknown): SkillInfo[] {
  if (!Array.isArray(raw)) return [];
  const out: SkillInfo[] = [];
  for (const s of raw as Array<Record<string, unknown> | undefined>) {
    if (typeof s?.name !== "string" || typeof s?.filePath !== "string") continue;
    out.push({
      name: s.name,
      description: typeof s.description === "string" ? s.description : "",
      filePath: s.filePath,
      disableModelInvocation: s.disableModelInvocation === true,
    });
  }
  return out;
}

function invocable(skills: SkillInfo[]): SkillInfo[] {
  return skills.filter((s) => !s.disableModelInvocation);
}

function compactCatalogue(skills: SkillInfo[]): string {
  // Frontmatter descriptions may be multi-line; the catalogue is one line per skill.
  const oneLine = (s: string) => s.replace(/\s*\r?\n\s*/g, " ").trim();
  const lines = [
    "The following skills provide specialized instructions for specific tasks.",
    "Use the use_skill tool to load a skill's full instructions when the task matches its description; do not read skill files manually.",
    "",
  ];
  for (const s of skills) lines.push(`- ${oneLine(s.name)}: ${oneLine(s.description)}`);
  return lines.join("\n");
}

const SKILLS_SECTION = /<skills>\n[\s\S]*?\n<\/skills>/;

// Swap pi's XML skill block for the compact catalogue. Only rewrites when pi
// rendered a skills section; never injects one that is not there.
function rewriteSkillsSection(systemPrompt: string, skills: SkillInfo[]): string {
  if (!SKILLS_SECTION.test(systemPrompt)) return systemPrompt;
  const visible = invocable(skills);
  if (visible.length === 0) return systemPrompt;
  return systemPrompt.replace(SKILLS_SECTION, () => `<skills>\n${compactCatalogue(visible)}\n</skills>`);
}

function textResult(text: string, details: Record<string, unknown> = {}) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

function errorResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    details: {},
    isError: true as const,
  };
}

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", (event, ctx) => {
    const skills = normalizeSkills(event.systemPromptOptions?.skills);
    catalogueBySession.set(ctx.sessionManager, skills);
    const rewritten = rewriteSkillsSection(event.systemPrompt, skills);
    return rewritten === event.systemPrompt ? {} : { systemPrompt: rewritten };
  });

  pi.registerTool({
    name: "use_skill",
    label: "Use Skill",
    description:
      "Load an Agent Skill by name and return its full instructions (SKILL.md body). " +
      "Use when a task matches a skill's description, instead of reading the skill file manually.",
    promptSnippet: "Load a skill's full instructions by name",
    promptGuidelines: [
      "The system prompt's skills section lists every model-invokable skill; use use_skill to load one when the task matches its description.",
      "Do not use use_skill for skills marked user-only; the tool reports them as unavailable.",
    ],
    parameters: Type.Object({
      skill: Type.String({ description: "Name of the skill to load" }),
      args: Type.Optional(
        Type.String({
          description: "Optional arguments for the skill; the skill body declares how it consumes them",
        }),
      ),
    }),
    async execute(toolCallId, params, _signal, _onUpdate, ctx) {
      const catalogue = catalogueBySession.get(ctx.sessionManager);
      if (!catalogue) {
        return errorResult(
          "Skill catalogue unavailable for this session (no agent run has started yet).",
        );
      }

      const target = invocable(catalogue).find((s) => s.name === params.skill);
      if (!target) {
        const userOnly = catalogue.find((s) => s.name === params.skill);
        return errorResult(
          userOnly
            ? `Skill "${params.skill}" is user-only (disable-model-invocation); ask the user to invoke it via /skill:${params.skill}.`
            : `Skill "${params.skill}" not found.`,
        );
      }

      let body: string;
      try {
        body = fs.readFileSync(target.filePath, "utf8");
      } catch (err) {
        return errorResult(
          `Skill "${target.name}" could not be read from ${target.filePath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const text =
        `Skill "${target.name}" loaded from ${target.filePath}:\n\n${body}` +
        (params.args !== undefined ? `\n\nArguments: ${params.args}` : "");

      // Nested calls are identified by the `<calling id>/<n>` id scheme of
      // ctx.executeTool(); their tool result never reaches the model.
      if (toolCallId.includes("/")) {
        pi.sendMessage(
          {
            customType: "skill_body",
            content: text,
            display: false,
            details: { skill: target.name, nested: true },
          },
          { deliverAs: "steer" },
        );
        return textResult(
          `Skill "${target.name}" loaded; full instructions delivered to the conversation.`,
          { skill: target.name, nested: true },
        );
      }

      return textResult(text, { skill: target.name, path: target.filePath });
    },
  });
}
