import { createWriteStream } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { finished } from "node:stream/promises";
import { databaseName, databaseUrl, ensureParent, mysqlCommand, sha256File, waitFor, writeJson } from "./mysql-backup-lib.mjs";

const startedAt = new Date();
const url = databaseUrl();
const database = databaseName(url);
const stamp = startedAt.toISOString().replace(/[:.]/gu, "-");
const output = resolve(process.argv[2] ?? join(process.env.BACKUP_DIRECTORY ?? ".backups", `${database}-${stamp}.sql`));
await ensureParent(output);
const dump = mysqlCommand(url, "mysqldump", ["--single-transaction", "--routines", "--events", "--hex-blob", "--set-gtid-purged=OFF", database]);
const destination = createWriteStream(output, { flags: "wx" });
dump.stdout.pipe(destination);
await waitFor(dump, "mysqldump failed");
await finished(destination);
const checksumSha256 = await sha256File(output);
const info = await stat(output);
const metadata = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  startedAt: startedAt.toISOString(),
  source: { host: url.hostname, port: Number(url.port || 3306), database },
  file: output,
  bytes: info.size,
  checksumAlgorithm: "sha256",
  checksumSha256,
  mode: process.env.MYSQL_BACKUP_MODE ?? "docker"
};
await writeFile(`${output}.sha256`, `${checksumSha256}  ${output.split(/[\\/]/u).at(-1)}\n`, "utf8");
await writeJson(`${output}.metadata.json`, metadata);
process.stdout.write(`${JSON.stringify(metadata)}\n`);
