import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";

export const databaseUrl = (name = "DATABASE_URL") => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  const url = new URL(value);
  if (url.protocol !== "mysql:") throw new Error(`${name} must be a mysql URL.`);
  return url;
};

export const databaseName = (url) => decodeURIComponent(url.pathname.replace(/^\//u, ""));

export const sha256File = async (path) => new Promise((resolveHash, reject) => {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  stream.on("data", (chunk) => hash.update(chunk));
  stream.on("error", reject);
  stream.on("end", () => resolveHash(hash.digest("hex")));
});

const dockerArgs = (url, command, extraArgs) => [
  "compose", "exec", "-T", "-e", `MYSQL_PWD=${decodeURIComponent(url.password)}`,
  process.env.MYSQL_DOCKER_SERVICE ?? "mysql", command,
  `-u${decodeURIComponent(url.username)}`, ...extraArgs
];

const directArgs = (url, extraArgs) => [
  `--host=${url.hostname}`, `--port=${url.port || "3306"}`, `--user=${decodeURIComponent(url.username)}`, ...extraArgs
];

export const mysqlCommand = (url, command, extraArgs, options = {}) => {
  const useDocker = (process.env.MYSQL_BACKUP_MODE ?? "docker") === "docker";
  const executable = useDocker ? "docker" : command;
  const args = useDocker ? dockerArgs(url, command, extraArgs) : directArgs(url, extraArgs);
  const env = { ...process.env, MYSQL_PWD: decodeURIComponent(url.password) };
  return spawn(executable, args, { env, stdio: options.stdio ?? ["ignore", "pipe", "pipe"] });
};

export const waitFor = async (child, errorPrefix) => {
  let stderr = "";
  child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
  const code = await new Promise((resolveCode, reject) => {
    child.once("error", reject);
    child.once("close", resolveCode);
  });
  if (code !== 0) throw new Error(`${errorPrefix} (exit ${code}): ${stderr.slice(-2_000)}`);
};

export const ensureParent = (path) => mkdir(dirname(resolve(path)), { recursive: true });
export const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
export const writeJson = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
