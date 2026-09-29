import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { readJson, sha256File } from "./mysql-backup-lib.mjs";

const path = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Usage: pnpm backup:verify -- <backup.sql>");
const [metadata, checksumFile, actual, info] = await Promise.all([
  readJson(`${path}.metadata.json`), readFile(`${path}.sha256`, "utf8"), sha256File(path), stat(path)
]);
const recorded = checksumFile.trim().split(/\s+/u)[0];
if (actual !== recorded || actual !== metadata.checksumSha256 || info.size !== metadata.bytes) {
  throw new Error("Backup checksum or byte length does not match its metadata.");
}
process.stdout.write(`${JSON.stringify({ valid: true, file: path, bytes: info.size, checksumSha256: actual })}\n`);
