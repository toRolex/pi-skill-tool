import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, test } from "node:test";

function installedPiRoot() {
  try {
    return dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
  } catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
  }
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    const executable = join(directory, "pi");
    if (!existsSync(executable)) continue;
    const real = realpathSync(executable);
    const shimTarget = readFileSync(real, "utf8").match(/^# cmd-shim-target=(.+)$/m)?.[1];
    let current = dirname(shimTarget ?? real);
    while (dirname(current) !== current) {
      const manifest = join(current, "package.json");
      if (existsSync(manifest) && JSON.parse(readFileSync(manifest, "utf8")).name === "@earendil-works/pi-coding-agent") {
        return current;
      }
      current = dirname(current);
    }
  }
  throw new Error("Install @earendil-works/pi-coding-agent locally or expose its pi CLI on PATH before running tests.");
}

const piRoot = installedPiRoot();
const fromPi = (relative) => import(pathToFileURL(join(piRoot, relative)).href);
const { loadExtensions } = await fromPi("dist/core/extensions/loader.js");
const { ExtensionRunner } = await fromPi("dist/core/extensions/runner.js");
const { SessionManager } = await fromPi("dist/core/session-manager.js");
const { buildSystemPrompt } = await fromPi("dist/core/system-prompt.js");
const cwd = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = mkdtempSync(join(tmpdir(), "pi-skill-tool-test-"));
after(() => rmSync(fixtureDir, { recursive: true, force: true }));
const ordinaryPath = join(fixtureDir, "ordinary.md");
const disabledPath = join(fixtureDir, "disabled.md");
writeFileSync(ordinaryPath, "# Ordinary\nOrdinary instructions.");
writeFileSync(disabledPath, "# Disabled\nExplicit instructions.");
const ordinary = { name: "ordinary", description: "Ordinary task", filePath: ordinaryPath, disableModelInvocation: false };
const disabled = { name: "disabled", description: "Secret task", filePath: disabledPath, disableModelInvocation: true };
const skills = [ordinary, disabled];
const loaded = await loadExtensions([join(cwd, "src/extension.ts")], cwd);
assert.deepEqual(loaded.errors, []);
assert.equal(loaded.extensions.length, 1);

function session() {
  const messages = [];
  const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, cwd, SessionManager.inMemory(cwd), {});
  runner.bindCore({
    sendMessage: (message, options) => messages.push({ message, options }),
  }, {
    getModel: () => undefined,
    getScopedModels: () => [],
    isIdle: () => true,
    isProjectTrusted: () => true,
    getSignal: () => undefined,
    abort: () => {},
    hasPendingMessages: () => false,
    shutdown: () => {},
    getContextUsage: () => undefined,
    compact: () => {},
    getSystemPrompt: () => "",
  });
  const tool = runner.getAllRegisteredTools().find(({ definition }) => definition.name === "use_skill")?.definition;
  assert.equal(tool?.name, "use_skill");
  return {
    messages,
    async start(catalogue = skills, options = {}) {
      const result = await runner.emitBeforeAgentStart("load a skill", undefined, {
        cwd, selectedTools: ["read"], skills: catalogue, ...options,
      });
      assert.deepEqual(result.messages, []);
      return buildSystemPrompt(result.systemPromptOptions);
    },
    execute(skill, args, id = "direct-call") {
      return tool.execute(id, { skill, ...(args === undefined ? {} : { args }) }, undefined, undefined, runner.createContext());
    },
  };
}

function expectedBody(name, path, body, args) {
  return `Skill "${name}" loaded from ${path}:\n\n${body}` + (args === undefined ? "" : `\n\nArguments: ${args}`);
}

test("disabled skill loads directly by explicit name with arguments", async () => {
  const s = session();
  await s.start();
  assert.deepEqual(await s.execute("disabled", "run now"), {
    content: [{ type: "text", text: expectedBody("disabled", disabledPath, "# Disabled\nExplicit instructions.", "run now") }],
    details: { skill: "disabled", path: disabledPath },
  });
  assert.deepEqual(s.messages, []);
});

test("catalogue hides disabled skills while ordinary skills remain visible", async () => {
  const s = session();
  const prompt = await s.start();
  assert.match(prompt, /<skills>\nThe following skills/);
  assert.match(prompt, /- ordinary: Ordinary task/);
  assert.doesNotMatch(prompt, /disabled|Secret task/);
  assert.doesNotMatch(prompt, /<available_skills>|<location>/);
});

test("ordinary direct call returns the full body without duplicate messages", async () => {
  const s = session();
  await s.start();
  assert.deepEqual(await s.execute("ordinary"), {
    content: [{ type: "text", text: expectedBody("ordinary", ordinaryPath, "# Ordinary\nOrdinary instructions.") }],
    details: { skill: "ordinary", path: ordinaryPath },
  });
  assert.deepEqual(s.messages, []);
});

test("unknown skill is an error with no steering message", async () => {
  const s = session();
  await s.start();
  assert.deepEqual(await s.execute("missing"), {
    content: [{ type: "text", text: 'Skill "missing" not found.' }], details: {}, isError: true,
  });
  assert.deepEqual(s.messages, []);
});

test("file read failure reports the skill and path", async () => {
  const s = session();
  const missingPath = join(fixtureDir, "absent.md");
  await s.start([{ ...ordinary, filePath: missingPath }]);
  const result = await s.execute("ordinary");
  assert.equal(result.isError, true);
  assert.deepEqual(result.details, {});
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, "text");
  assert.ok(result.content[0].text.startsWith(`Skill "ordinary" could not be read from ${missingPath}: `));
  assert.match(result.content[0].text, /ENOENT/);
  assert.deepEqual(s.messages, []);
});

for (const [skill, path, body] of [
  ["disabled", disabledPath, "# Disabled\nExplicit instructions."],
  ["ordinary", ordinaryPath, "# Ordinary\nOrdinary instructions."],
]) {
  test(`${skill} nested call steers the body exactly once and returns only acknowledgement`, async () => {
    const s = session();
    await s.start();
    assert.deepEqual(await s.execute(skill, "nested args", "parent/1"), {
      content: [{ type: "text", text: `Skill "${skill}" loaded; full instructions delivered to the conversation.` }],
      details: { skill, nested: true },
    });
    assert.deepEqual(s.messages, [{
      message: {
        customType: "skill_body", content: expectedBody(skill, path, body, "nested args"), display: false,
        details: { skill, nested: true },
      },
      options: { deliverAs: "steer" },
    }]);
  });
}

test("nested unknown and read errors do not send messages", async () => {
  const s = session();
  await s.start([{ ...disabled, filePath: join(fixtureDir, "missing-disabled.md") }]);
  assert.deepEqual(await s.execute("missing", undefined, "parent/1"), {
    content: [{ type: "text", text: 'Skill "missing" not found.' }], details: {}, isError: true,
  });
  const unreadable = await s.execute("disabled", undefined, "parent/2");
  assert.equal(unreadable.isError, true);
  assert.match(unreadable.content[0].text, /could not be read.*ENOENT/);
  assert.deepEqual(s.messages, []);
});

test("unstarted sessions cannot use another same-cwd session's catalogue", async () => {
  const a = session();
  await a.start([ordinary]);
  const b = session();
  assert.deepEqual(await b.execute("ordinary"), {
    content: [{ type: "text", text: "Skill catalogue unavailable for this session (no agent run has started yet)." }],
    details: {}, isError: true,
  });
  await b.start([disabled]);
  assert.deepEqual(await a.execute("disabled"), {
    content: [{ type: "text", text: 'Skill "disabled" not found.' }], details: {}, isError: true,
  });
  assert.equal((await a.execute("ordinary")).content[0].text, expectedBody("ordinary", ordinaryPath, "# Ordinary\nOrdinary instructions."));
  assert.equal((await b.execute("disabled")).content[0].text, expectedBody("disabled", disabledPath, "# Disabled\nExplicit instructions."));
  assert.deepEqual(await b.execute("ordinary"), {
    content: [{ type: "text", text: 'Skill "ordinary" not found.' }], details: {}, isError: true,
  });
});

test("a prompt without a skills section stays unchanged", async () => {
  const s = session();
  assert.equal(await s.start(skills, { forceSystemPrompt: "Only this prompt." }), "Only this prompt.");
  assert.equal((await s.execute("ordinary")).content[0].text, expectedBody("ordinary", ordinaryPath, "# Ordinary\nOrdinary instructions."));
});

test("disabled-only skills do not inject a catalogue into the prompt", async () => {
  const s = session();
  const options = { cwd, selectedTools: ["read"], skills: [disabled] };
  const original = buildSystemPrompt(options);
  assert.equal(await s.start([disabled]), original);
  assert.doesNotMatch(original, /<skills>|disabled|Secret task/);
  assert.match(original, /read/);
});
