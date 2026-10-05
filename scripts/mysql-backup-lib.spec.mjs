import assert from "node:assert/strict";
import { test } from "node:test";
import { databaseName, databaseUrl, mysqlCommand } from "./mysql-backup-lib.mjs";

test("backup URL requires an explicit MySQL connection", () => {
  assert.throws(() => databaseUrl("POSTBOT_BACKUP_GUARD_TEST_URL"), /required/);
  process.env.POSTBOT_BACKUP_GUARD_TEST_URL = "https://database.example/fixture";
  try { assert.throws(() => databaseUrl("POSTBOT_BACKUP_GUARD_TEST_URL"), /mysql URL/); }
  finally { delete process.env.POSTBOT_BACKUP_GUARD_TEST_URL; }
});
test("database name is decoded without changing the selected target", () => {
  assert.equal(databaseName(new URL("mysql://localhost:3307/release%5Frestore")), "release_restore");
});
test("Docker mode cannot silently back up a remote URL from local Compose", () => {
  const previous = process.env.MYSQL_BACKUP_MODE;
  process.env.MYSQL_BACKUP_MODE = "docker";
  try {
    for (const value of ["mysql://remote.example:3306/fixture", "mysql://localhost:3308/fixture", "mysql://localhost:3306/fixture", "mysql://localhost/fixture", "mysql://mysql:3307/fixture"]) {
      assert.throws(() => mysqlCommand(new URL(value), "mysql", []), /local Compose MySQL/);
    }
  } finally {
    if (previous === undefined) delete process.env.MYSQL_BACKUP_MODE;
    else process.env.MYSQL_BACKUP_MODE = previous;
  }
});

test("unknown backup modes fail before connecting", () => {
  const previous = process.env.MYSQL_BACKUP_MODE;
  process.env.MYSQL_BACKUP_MODE = "invalid";
  try { assert.throws(() => mysqlCommand(new URL("mysql://localhost:3307/fixture"), "mysql", []), /docker or direct/); }
  finally {
    if (previous === undefined) delete process.env.MYSQL_BACKUP_MODE;
    else process.env.MYSQL_BACKUP_MODE = previous;
  }
});
