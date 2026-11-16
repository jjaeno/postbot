import "dotenv/config";
import { recoverQueues } from "./queue-recovery.js";
import { createPrismaClient } from "@postbot/database";
import { BullMqQueueAdapter } from "@postbot/jobs";
import { loadConfig } from "@postbot/config";

const prisma = createPrismaClient();
const config = loadConfig();
const queue = new BullMqQueueAdapter(config.REDIS_URL);


try {
  process.stdout.write(`${JSON.stringify(await recoverQueues(prisma, queue, config.QUEUE_RECOVERY_STALE_AFTER_MS))}\n`);
} finally {
  await queue.close();
  await prisma.$disconnect();
}
