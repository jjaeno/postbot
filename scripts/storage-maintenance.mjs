import { PrismaClient } from "../packages/database/dist/index.js";
import { loadConfig } from "../packages/config/dist/index.js";
import { S3StorageProvider } from "../packages/providers/dist/index.js";
import { auditStorage, restoreStorageRecord } from "../apps/worker/dist/storage-audit.js";
if (!process.env.DATABASE_URL) throw new Error("EXPLICIT_DATABASE_URL_REQUIRED");
const [action, workspaceId, ...args] = process.argv.slice(2); if (!workspaceId || !["audit", "verify-restore"].includes(action)) throw new Error("Usage: storage-maintenance.mjs audit <workspaceId> [assetCursor sceneCursor objectCursor] | verify-restore <workspaceId> <ASSET|RENDER> <resourceId> <evidenceSha256>");
const config = loadConfig(); if (config.STORAGE_PROVIDER !== "s3") throw new Error("CLI_REQUIRES_PERSISTENT_STORAGE");
const prisma = new PrismaClient(); const storage = new S3StorageProvider({ endpoint: config.S3_ENDPOINT, region: config.S3_REGION, bucket: config.S3_BUCKET, accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY });
try { let result;
 if (action === "audit") result = await auditStorage(prisma, storage, workspaceId, { asset: args[0] || undefined, scene: args[1] || undefined, object: args[2] || undefined }, { scanGlobalOrphans: true });
 else { if (!["ASSET", "RENDER"].includes(args[0])) throw new Error("INVALID_RESOURCE_KIND"); result = await restoreStorageRecord(prisma, storage, workspaceId, args[0], args[1], args[2]); }
 process.stdout.write(JSON.stringify(result) + "\n");
} finally { await prisma.$disconnect(); }
