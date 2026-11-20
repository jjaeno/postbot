import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm, utimes } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { archiveBackup, decryptBackup, encryptionKey, retainArchives } from "./backup-archive-lib.mjs";
import { sha256File, writeJson } from "./mysql-backup-lib.mjs";
test("encrypted backup verifies metadata, rejects tampering and retains only scoped archives", async () => {
 const directory = await mkdtemp(join(tmpdir(), "postbot-backup-test-"));
 try {
  const source = join(directory, "fixture.sql"); const archive = join(directory, "postbot-fixture-old.sql.enc"); const key = randomBytes(32);
  await writeFile(source, "CREATE TABLE fixture(id INT); INSERT INTO fixture VALUES (1);\n");
  await writeJson(`${source}.metadata.json`, { checksumSha256: await sha256File(source), bytes: (await readFile(source)).length });
  const metadata = await archiveBackup(source, archive, key); assert.equal(metadata.cipher, "aes-256-gcm");
  const target = join(directory, "decrypted.sql"); await decryptBackup(archive, target, key); assert.deepEqual(await readFile(target), await readFile(source));
  await assert.rejects(decryptBackup(archive, join(directory, "wrong.sql"), randomBytes(32)));
  await writeFile(join(directory, "bad.key"), "bad"); await assert.rejects(encryptionKey(join(directory, "bad.key")), /32_RAW_BYTES/);
  const bytes = await readFile(archive); bytes[0] ^= 1; await writeFile(archive, bytes); await assert.rejects(decryptBackup(archive, join(directory, "tampered.sql"), key), /CHECKSUM/);
  await utimes(archive, new Date(0), new Date(0)); await writeFile(join(directory, "unrelated.sql.enc"), "preserve");
  assert.equal(await retainArchives(directory, "postbot-fixture", 7), 1); assert.equal(await readFile(join(directory, "unrelated.sql.enc"), "utf8"), "preserve");
 } finally { assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + "postbot-backup-test-")); await rm(directory, { recursive: true, force: true }); }
});
