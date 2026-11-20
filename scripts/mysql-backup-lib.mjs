import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

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
  "compose", "exec", "-T", "-e", "MYSQL_PWD",
  process.env.MYSQL_DOCKER_SERVICE ?? "mysql", command,
  `-u${decodeURIComponent(url.username)}`, ...extraArgs
];

const directArgs = (url, extraArgs) => [
  `--host=${url.hostname}`, `--port=${url.port || "3306"}`, `--user=${decodeURIComponent(url.username)}`, ...extraArgs
];

export const mysqlCommand = (url, command, extraArgs, options = {}) => {
  const mode = process.env.MYSQL_BACKUP_MODE ?? "docker";
  if (!["docker", "direct"].includes(mode)) throw new Error("MYSQL_BACKUP_MODE must be docker or direct.");
  const useDocker = mode === "docker";
  const container = process.env.MYSQL_DOCKER_CONTAINER;
  let mappedContainer = false;
  if (useDocker && container) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/u.test(container) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Explicit backup container requires a local mapped URL.");
    const inspection = spawnSync("docker", ["inspect", "--format", "{{json .NetworkSettings.Ports}}", container], { encoding: "utf8", windowsHide: true });
    if (inspection.status !== 0) throw new Error("Cannot inspect backup container port mapping.");
    const ports = JSON.parse(inspection.stdout)["3306/tcp"] ?? [];
    mappedContainer = ports.some((port) => port.HostPort === (url.port || "3306"));
    if (!mappedContainer) throw new Error("Backup URL does not match the explicit container's mapped MySQL port.");
  }
  const localCompose = url.hostname === "mysql" ? (url.port || "3306") === "3306" : ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && url.port === "3307";
  if (useDocker && !localCompose && !mappedContainer) {
    throw new Error("Docker backup mode targets the local Compose MySQL only. Use MYSQL_BACKUP_MODE=direct for a remote database.");
  }
  const executable = useDocker ? "docker" : command;
  const args = useDocker ? container ? ["exec", "-i", "-e", "MYSQL_PWD", container, command, `-u${decodeURIComponent(url.username)}`, ...extraArgs] : dockerArgs(url, command, extraArgs) : directArgs(url, extraArgs);
  const env = { ...process.env, MYSQL_PWD: decodeURIComponent(url.password) };
  return spawn(executable, args, { env, windowsHide: true, stdio: options.stdio ?? ["ignore", "pipe", "pipe"] });
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
