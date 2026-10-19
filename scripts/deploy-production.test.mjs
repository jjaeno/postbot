import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const invoke = (apply, failMigration = false) => {
  const directory = mkdtempSync(join(tmpdir(), "postbot-deploy-safety-"));
  const envPath = join(directory, "fixture.env");
  const stubPath = join(directory, "docker-stub.cjs");
  const logPath = join(directory, "commands.jsonl");
  writeFileSync(envPath, "APP_ENV=test\n", { mode: 0o600 });
  writeFileSync(logPath, "");
  writeFileSync(stubPath, String.raw`const fs = require('node:fs');
require('node:child_process').spawnSync = (_command, args) => {
 fs.appendFileSync(process.env.DEPLOY_TEST_LOG, JSON.stringify(args) + '\n');
 return { status: process.env.DEPLOY_TEST_FAIL === '1' && args.includes('run') && args.at(-1) === 'migrate' ? 1 : 0 };
};
require('node:module').syncBuiltinESMExports();`);
  const environment = { ...process.env, POSTBOT_PROJECT: "postbot-deploy-safety", POSTBOT_ENV_FILE: envPath, DEPLOY_TEST_LOG: logPath, DEPLOY_TEST_FAIL: failMigration ? "1" : "0" };
  for (const role of ["API", "WORKER", "RENDERER", "WEB", "MIGRATE", "PROXY"]) environment[`POSTBOT_${role}_IMAGE`] = `fixture/${role.toLowerCase()}@sha256:${"a".repeat(64)}`;
  try {
    const result = spawnSync(process.execPath, ["--require", stubPath, fileURLToPath(new URL("./deploy-production.mjs", import.meta.url)), ...(apply ? ["--apply"] : [])], { env: environment, encoding: "utf8" });
    const commands = readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    return { result, commands };
  } finally {
    // Only three known fixture files; no recursive cleanup or external state.
    for (const path of [envPath, stubPath, logPath]) unlinkSync(path);
    rmdirSync(directory);
  }
};

test("dry deploy validates config without pull, stop, migration or rollout", () => {
  const { result, commands } = invoke(false);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(commands.length, 1);
  assert.ok(commands[0].includes("config") && commands[0].includes("--quiet"));
});
test("failed migration drains old apps and prevents restarting incompatible writers", () => {
  const { result, commands } = invoke(true, true);
  assert.equal(result.status, 1);
  const stop = commands.findIndex((args) => args.includes("stop"));
  const migration = commands.findIndex((args) => args.includes("run") && args.at(-1) === "migrate");
  assert.ok(stop >= 0 && migration > stop);
  assert.ok(["api", "worker", "renderer", "web"].every((role) => commands[stop].includes(role)));
  assert.equal(commands.length, migration + 1);
});
test("successful migration runs once before app rollout", () => {
  const { result, commands } = invoke(true);
  assert.equal(result.status, 0, result.stderr);
  const migrations = commands.filter((args) => args.includes("run") && args.at(-1) === "migrate");
  assert.equal(migrations.length, 1);
  const migration = commands.indexOf(migrations[0]);
  const rollout = commands.findIndex((args) => args.includes("up") && args.includes("--wait") && args.includes("api"));
  assert.ok(rollout > migration);
});
