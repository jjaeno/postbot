import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { readFile, rename, stat, unlink, readdir } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { sha256File, writeJson, readJson } from "./mysql-backup-lib.mjs";
export async function encryptionKey(path) {
  if (!path) throw new Error("BACKUP_ENCRYPTION_KEY_FILE_REQUIRED");
  const key = await readFile(path); if (key.byteLength !== 32) throw new Error("BACKUP_KEY_MUST_BE_32_RAW_BYTES"); return key;
}
export async function archiveBackup(source, archive, key) {
  const metadata = await readJson(`${source}.metadata.json`);
  if (await sha256File(source) !== metadata.checksumSha256) throw new Error("SOURCE_CHECKSUM_MISMATCH");
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key, iv);
  await pipeline(createReadStream(source), cipher, createWriteStream(`${archive}.partial`, { flags: "wx", mode: 0o600 }));
  await rename(`${archive}.partial`, archive);
  const checksumSha256 = await sha256File(archive);
  const result = { version: 1, cipher: "aes-256-gcm", iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex"), checksumSha256, bytes: (await stat(archive)).size, sourceMetadata: metadata };
  await writeJson(`${archive}.metadata.json`, result); return result;
}
export async function decryptBackup(archive, target, key) {
  const metadata = await readJson(`${archive}.metadata.json`);
  if (metadata.version !== 1 || metadata.cipher !== "aes-256-gcm" || await sha256File(archive) !== metadata.checksumSha256 || (await stat(archive)).size !== metadata.bytes) throw new Error("ARCHIVE_CHECKSUM_OR_CONTRACT_MISMATCH");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(metadata.iv, "hex")); decipher.setAuthTag(Buffer.from(metadata.tag, "hex"));
  try {
    await pipeline(createReadStream(archive), decipher, createWriteStream(target, { flags: "wx", mode: 0o600 }));
    if (await sha256File(target) !== metadata.sourceMetadata.checksumSha256) throw new Error("DECRYPTED_CHECKSUM_MISMATCH");
    await writeJson(`${target}.metadata.json`, metadata.sourceMetadata); return metadata.sourceMetadata;
  } catch (error) { await unlink(target).catch(() => {}); throw error; }
}
export async function retainArchives(directory, prefix, days, now = Date.now()) {
  if (!/^[a-z0-9-]+$/u.test(prefix) || !Number.isInteger(days) || days < 1) throw new Error("INVALID_RETENTION_SCOPE");
  const root = resolve(directory); let removed = 0;
  for (const name of await readdir(root)) {
    if (!name.startsWith(prefix + "-") || !name.endsWith(".sql.enc")) continue;
    const path = resolve(join(root, name)); if (!path.startsWith(root + sep)) throw new Error("ARCHIVE_SCOPE_ESCAPE");
    if ((await stat(path)).mtimeMs >= now - days * 86400000) continue;
    await unlink(path); await unlink(`${path}.metadata.json`).catch(() => {}); removed++;
  }
  return removed;
}
