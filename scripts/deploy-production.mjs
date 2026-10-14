import { spawnSync } from "node:child_process";
import { isAbsolute, relative, resolve } from "node:path";
import { realpathSync, statSync } from "node:fs";

const imageKeys = ["POSTBOT_MIGRATE_IMAGE", "POSTBOT_API_IMAGE", "POSTBOT_WORKER_IMAGE", "POSTBOT_RENDERER_IMAGE", "POSTBOT_WEB_IMAGE", "POSTBOT_PROXY_IMAGE"];
for (const key of imageKeys) if (!/^.+@sha256:[a-f0-9]{64}$/.test(process.env[key] ?? "")) throw new Error(`${key} must reference an immutable digest`);
const path = process.env.POSTBOT_ENV_FILE ?? "";
if (!isAbsolute(path) || !statSync(path).isFile()) throw new Error("POSTBOT_ENV_FILE must be an absolute environment file path outside the checkout");
const relativePath = relative(realpathSync(process.cwd()), realpathSync(resolve(path)));
if (!relativePath.startsWith("..") && !isAbsolute(relativePath)) throw new Error("Keep the secret environment file outside the checkout");
if (process.platform !== "win32" && (statSync(path).mode & 0o077) !== 0) throw new Error("The deployment environment file must be owner-only (chmod 600)");
const localInfra = process.argv.includes("--local-infra");
if (localInfra) for (const key of ["POSTBOT_MYSQL_IMAGE", "POSTBOT_REDIS_IMAGE", "POSTBOT_MINIO_IMAGE"]) if (!/^.+@sha256:[a-f0-9]{64}$/.test(process.env[key] ?? "")) throw new Error(`${key} must reference an immutable digest`);
const project = process.env.POSTBOT_PROJECT;
if (!project || !/^[a-z0-9][a-z0-9_-]+$/.test(project)) throw new Error("Set distinct POSTBOT_PROJECT names for staging and production");
const run = (args) => {
  const result = spawnSync("docker", ["compose", "-p", project, "-f", "docker-compose.production.yml", ...(localInfra ? ["-f", "docker-compose.production-infra.yml"] : []), ...args], { stdio: "inherit" });
  if (result.status !== 0) throw new Error("Deployment step failed; rollout stopped");
};
// config -q avoids writing the secret-bearing merged Compose document to stdout.
run(["config", "--quiet"]);
if (!process.argv.includes("--apply")) {
  process.stdout.write("Configuration accepted. No pull, migration or rollout executed. After backup verification and approval, run with --apply.\n");
} else {
  run(["pull"]);
  if (localInfra) run(["up", "-d", "--wait", "mysql", "redis", "minio"]);
  // Public object-storage TLS is required before probing signed media access.
  run(["up", "-d", "--no-deps", "proxy"]);
  run(["run", "--rm", "--no-deps", "--entrypoint", "node", "worker", "dist/preflight.js", "--network"]);
  // The asset uniqueness migration is incompatible with the old writer.
  // Drain all application processes before DDL; failure leaves them stopped.
  run(["stop", "api", "worker", "renderer", "web"]);
  run(["run", "--rm", "--no-deps", "migrate"]);
  // Migration has already succeeded. Do not silently run it a second time.
  run(["up", "-d", "--no-deps", "--wait", "api", "worker", "renderer", "web"]);
  run(["up", "-d", "--no-deps", "proxy"]);
}
