// pi-skill-tool: expose skills as a first-class callable tool (function-calling),
// instead of relying on the model to read SKILL.md on own.
//
// - Primary agent: `use_skill` tool returns the skill body directly as the tool result.
// - Subagents (pi-subagents ambient children): the tool registers into child sessions too,
//   so spawned agents get the same mechanism.
// - Both paths filter out skills marked `disable-model-invocation: true` (those stay
//   user-only via `/skill:name`, matching pi's native semantics).
//
// Enumeration: pi exposes the authoritative loaded-skill list on
// `before_agent_start -> event.systemPromptOptions.skills` (each entry has
// `name`, `description`, `filePath`, `disableModelInvocation`). There is no
// `pi.getSystemPromptOptions()` / `pi.getSkills()` on the ExtensionAPI, and the
// tool execute ctx does not carry skills — so we cache the list from that event
// per cwd, with a filesystem-scan fallback for the (rare) case no run has
// started yet in that cwd.
//
// Install: drop this file into ~/.pi/agent/extensions/ (or a project .pi/extensions/ dir).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type LoadedSkill = {
  name?: string;
  description?: string;
  filePath?: string;
  path?: string;
  disableModelInvocation?: boolean;
};

// Per-cwd cache of the skills pi loaded for that session. Parent and subagent
// child sessions share this module (in-process), so keying by cwd keeps the
// project-skill sets apart.
const skillsByCwd = new Map<string, LoadedSkill[]>();

function cacheSkills(cwd: string | undefined, skills: unknown): void {
  if (!cwd || !Array.isArray(skills)) return;
  skillsByCwd.set(path.resolve(cwd), skills as LoadedSkill[]);
}

// --- Fallback: scan the same locations pi documents (docs/skills.md) ---

function parseFrontmatterBoolean(raw: string, key: string): boolean {
  return new RegExp(`^${key}:\\s*true\\s*$`, "m").test(raw);
}

function parseFrontmatterField(raw: string, key: string): string | undefined {
  const m = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(raw);
  const value = m?.[1]?.trim();
  if (!value) return undefined;
  // strip simple yaml quoting
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
    (value.startsWith("'") && value.endsWith("'") && value.length > 1)
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function readSkillEntry(filePath: string): LoadedSkill | undefined {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const fm = /^---\s*\n([\s\S]*?)\n---/.exec(raw);
    const body = fm ? fm[1] : "";
    const name = body ? parseFrontmatterField(body, "name") : undefined;
    const description = body ? parseFrontmatterField(body, "description") : undefined;
    if (!description) return undefined; // pi skips skills without a description
    return {
      name: name || path.basename(path.dirname(filePath)),
      description,
      filePath,
      disableModelInvocation: body
        ? parseFrontmatterBoolean(body, "disable-model-invocation")
        : false,
    };
  } catch {
    return undefined;
  }
}

function scanSkillDir(dir: string, includeRootFiles: boolean): LoadedSkill[] {
  const out: LoadedSkill[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const skillFile = path.join(full, "SKILL.md");
      if (fs.existsSync(skillFile)) {
        const e = readSkillEntry(skillFile);
        if (e) out.push(e);
      }
    } else if (
      includeRootFiles &&
      entry.isFile() &&
      entry.name.endsWith(".md") &&
      entry.name !== "SKILL.md"
    ) {
      const e = readSkillEntry(full);
      if (e) out.push(e);
    }
  }
  return out;
}

function scanSkillDirs(cwd: string | undefined): LoadedSkill[] {
  const home = os.homedir();
  const roots: Array<{ dir: string; includeRootFiles: boolean }> = [
    { dir: path.join(home, ".pi", "agent", "skills"), includeRootFiles: true },
    { dir: path.join(home, ".agents", "skills"), includeRootFiles: false },
  ];
  if (cwd) {
    roots.push({ dir: path.join(cwd, ".pi", "skills"), includeRootFiles: true });
    roots.push({ dir: path.join(cwd, ".agents", "skills"), includeRootFiles: false });
  }
  const seen = new Set<string>();
  const out: LoadedSkill[] = [];
  for (const { dir, includeRootFiles } of roots) {
    for (const e of scanSkillDir(dir, includeRootFiles)) {
      if (e.name && seen.has(e.name)) continue;
      if (e.name) seen.add(e.name);
      out.push(e);
    }
  }
  return out;
}

function getSkills(cwd: string | undefined): LoadedSkill[] {
  const key = cwd ? path.resolve(cwd) : "";
  const cached = skillsByCwd.get(key);
  if (cached) return cached;
  return scanSkillDirs(cwd);
}

function skillPath(skill: LoadedSkill): string | undefined {
  return skill.filePath ?? skill.path;
}

function isUsable(skill: LoadedSkill): boolean {
  return !skill.disableModelInvocation && !!skillPath(skill);
}

function loadBody(skill: LoadedSkill): string {
  const p = skillPath(skill);
  if (!p) throw new Error(`Skill has no file path: ${skill.name}`);
  return fs.readFileSync(p, "utf8");
}

function renderSkillList(skills: LoadedSkill[]): string {
  return skills
    .map((s) => `${s.name}: ${s.description ?? "(no description)"}`)
    .join("\n");
}

export default function (pi: ExtensionAPI) {
  // Cache the authoritative skill list before every agent run (parent + subagent children).
  pi.on("before_agent_start", async (event: unknown, ctx: unknown) => {
    const e = event as {
      systemPromptOptions?: { cwd?: string; skills?: unknown };
    };
    const c = ctx as { cwd?: string } | undefined;
    cacheSkills(
      e?.systemPromptOptions?.cwd ?? c?.cwd,
      e?.systemPromptOptions?.skills,
    );
  });

  pi.registerTool({
    name: "use_skill",
    label: "Use Skill",
    description:
      "Load an Agent Skill by name and return its full instructions (SKILL.md body). " +
      "Use when a task matches a skill's description, instead of reading the skill file manually.",
    promptSnippet: "Load a skill's full instructions by name",
    promptGuidelines: [
      "Use use_skill when the task matches a skill's description; the tool returns the skill body so you can follow it directly.",
      "Do not use use_skill for skills marked user-only; the tool reports them as unavailable.",
    ],
    parameters: Type.Object({
      skill: Type.String({ description: "Name of the skill to load" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const cwd = (ctx as { cwd?: string } | undefined)?.cwd;
      const skills = getSkills(cwd);
      const usable = skills.filter(isUsable);
      const target = usable.find((s) => s.name === params.skill);

      if (!target) {
        const hidden = skills.find((s) => s.name === params.skill && s.disableModelInvocation);
        const available = renderSkillList(usable);
        return {
          content: [
            {
              type: "text",
              text: hidden
                ? `Skill "${params.skill}" is user-only (disable-model-invocation: true). ` +
                  `Ask the user to invoke it via /skill:${params.skill}.\n\nAvailable skills:\n${available}`
                : `Skill "${params.skill}" not found.\n\nAvailable skills:\n${available}`,
            },
          ],
          details: { skill: params.skill, found: false },
        };
      }

      const body = loadBody(target);
      return {
        content: [
          {
            type: "text",
            text: `Skill "${target.name}" loaded from ${skillPath(target)}:\n\n${body}`,
          },
        ],
        details: { skill: target.name, path: skillPath(target) },
      };
    },
  });

  pi.registerTool({
    name: "list_skills",
    label: "List Skills",
    description:
      "List all model-invokable Agent Skills (name + description). " +
      "Use to discover which skills are available before deciding which to load.",
    promptSnippet: "List available skills with descriptions",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const cwd = (ctx as { cwd?: string } | undefined)?.cwd;
      const usable = getSkills(cwd).filter(isUsable);
      return {
        content: [
          {
            type: "text",
            text: usable.length
              ? renderSkillList(usable)
              : "No model-invokable skills are loaded.",
          },
        ],
        details: { count: usable.length },
      };
    },
  });
}
