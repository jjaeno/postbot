import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { databaseName, databaseUrl, mysqlCommand, readJson, sha256File, waitFor } from "./mysql-backup-lib.mjs";

const path = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Usage: pnpm backup:restore -- <backup.sql>");
const targetUrl = databaseUrl("RESTORE_DATABASE_URL");
const targetDatabase = databaseName(targetUrl);
const startedAt = Date.now();
if (!targetDatabase.endsWith("_restore") && process.env.ALLOW_PRODUCTION_RESTORE !== "1") {
  throw new Error("Restore target must end in _restore. Set ALLOW_PRODUCTION_RESTORE=1 only in an approved recovery window.");
}
const metadata = await readJson(`${path}.metadata.json`);
const checksum = await sha256File(path);
if (checksum !== metadata.checksumSha256) throw new Error("Backup checksum validation failed before restore.");
const escaped = targetDatabase.replace(/`/gu, "``");
const create = mysqlCommand(targetUrl, "mysql", ["-e", `CREATE DATABASE IF NOT EXISTS \`${escaped}\``]);
await waitFor(create, "Failed to create restore database");
const restore = mysqlCommand(targetUrl, "mysql", [targetDatabase], { stdio: ["pipe", "pipe", "pipe"] });
createReadStream(path).pipe(restore.stdin);
await waitFor(restore, "mysql restore failed");
const verify = mysqlCommand(targetUrl, "mysql", ["--batch", "--skip-column-names", targetDatabase, "-e", "SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL; SELECT COUNT(*) FROM workspaces; SELECT COUNT(*) FROM channels; SELECT COUNT(*) FROM content_items;"]);
let output = "";
verify.stdout.on("data", (chunk) => { output += String(chunk); });
await waitFor(verify, "Restored database integrity query failed");
const [migrations, workspaces, channels, contentItems] = output.trim().split(/\s+/u).map(Number);
if (!Number.isInteger(migrations) || migrations < 1) throw new Error("Restored database has no completed Prisma migration history.");
process.stdout.write(`${JSON.stringify({ restored: true, targetDatabase, checksumSha256: checksum, integrity: { migrations, workspaces, channels, contentItems }, restoreAndValidationMs: Date.now() - startedAt })}\n`);
