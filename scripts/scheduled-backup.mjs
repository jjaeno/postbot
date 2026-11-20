import { spawn } from "node:child_process";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { archiveBackup, decryptBackup, encryptionKey, retainArchives } from "./backup-archive-lib.mjs";
import { databaseUrl, databaseName, ensureParent, writeJson } from "./mysql-backup-lib.mjs";
const statusFile = process.env.BACKUP_STATUS_FILE;
if (!statusFile) throw new Error("BACKUP_STATUS_FILE_REQUIRED");
await ensureParent(statusFile);
let previous = {}; try { previous = JSON.parse(await readFile(statusFile, "utf8")); } catch { /* First execution. */ }
const status = async (value) => { await writeJson(`${statusFile}.partial`, value); await rename(`${statusFile}.partial`, statusFile); };
let lock;
try { lock = await open(`${statusFile}.lock`, "wx", 0o600); } catch { throw new Error("BACKUP_ALREADY_RUNNING_OR_STALE_LOCK_REVIEW_REQUIRED"); }
const run = (script, args) => new Promise((resolveRun, reject) => {
  const child = spawn(process.execPath, [script, ...args], { env: process.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); let output = "";
  child.stdout.on("data", (chunk) => { output += String(chunk); }); child.stderr.resume();
  child.once("error", reject); child.once("close", (code) => code === 0 ? resolveRun(output.trim()) : reject(new Error("BACKUP_COMMAND_FAILED")));
});
let source;
try {
  if (!process.env.BACKUP_ARCHIVE_DIRECTORY) throw new Error("BACKUP_ARCHIVE_DIRECTORY_REQUIRED");
  const key = await encryptionKey(process.env.BACKUP_ENCRYPTION_KEY_FILE);
  const db = databaseName(databaseUrl()); const prefix = `postbot-${createHash("sha256").update(db).digest("hex").slice(0, 12)}`;
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const archiveRoot = resolve(process.env.BACKUP_ARCHIVE_DIRECTORY); await mkdir(archiveRoot, { recursive: true });
  source = join(tmpdir(), `${prefix}-${stamp}.sql`);
  await run("scripts/backup-mysql.mjs", [source]); await run("scripts/verify-mysql-backup.mjs", [source]);
  const archive = join(archiveRoot, `${prefix}-${stamp}.sql.enc`); const metadata = await archiveBackup(source, archive, key);
  const verified = `${source}.verify`; await decryptBackup(archive, verified, key); await unlink(verified); await unlink(`${verified}.metadata.json`);
  const removed = await retainArchives(archiveRoot, prefix, Number(process.env.BACKUP_RETENTION_DAYS ?? 14));
  await status({ state: process.env.BACKUP_ARCHIVE_DESTINATION_KIND === "offsite_mount" ? "SUCCEEDED" : "LOCAL_TEST_ONLY", externalArchiveConfigured: process.env.BACKUP_ARCHIVE_DESTINATION_KIND === "offsite_mount", lastSuccessAt: new Date().toISOString(), encryptionVerified: true, archiveVerified: true, checksumVerified: true, checksumSha256: metadata.checksumSha256, bytes: metadata.bytes, restoreVerifiedAt: previous.restoreVerifiedAt ?? null, retainedDays: Number(process.env.BACKUP_RETENTION_DAYS ?? 14), removed });
  process.stdout.write(JSON.stringify({ state: process.env.BACKUP_ARCHIVE_DESTINATION_KIND === "offsite_mount" ? "SUCCEEDED" : "LOCAL_TEST_ONLY", archive, checksumSha256: metadata.checksumSha256 }) + "\n");
} catch (error) {
  await status({ ...previous, state: "FAILED", lastFailureAt: new Date().toISOString(), failureCode: error instanceof Error && /^[A-Z_]+$/u.test(error.message) ? error.message : "BACKUP_FAILED" }); throw error;
} finally {
  if (source) for (const suffix of ["", ".metadata.json", ".sha256"]) await unlink(source + suffix).catch(() => {});
  await lock.close(); await unlink(`${statusFile}.lock`);
}
