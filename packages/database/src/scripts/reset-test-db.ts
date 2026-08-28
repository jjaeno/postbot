import { spawnSync } from "node:child_process";

import { PrismaClient } from "@prisma/client";

import { getRootDatabaseUrl, getTestDatabaseName, getTestDatabaseUrl } from "./database-url.js";

const databaseName = getTestDatabaseName();
const rootClient = new PrismaClient({
  datasourceUrl: getRootDatabaseUrl()
});

const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

await rootClient.$executeRawUnsafe(
  `CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
);
await rootClient.$disconnect();

const result = spawnSync(
  packageManager,
  [
    "exec",
    "prisma",
    "migrate",
    "reset",
    "--schema",
    "prisma/schema.prisma",
    "--force",
    "--skip-seed"
  ],
  {
    cwd: new URL("../../", import.meta.url),
    env: {
      ...process.env,
      DATABASE_URL: getTestDatabaseUrl()
    },
    stdio: "inherit"
  }
);

if (result.status !== 0) {
  throw new Error(`Test database reset failed with exit code ${result.status ?? "unknown"}.`);
}
