import { PrismaClient } from "@postbot/database";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DeterministicJobProcessor } from "./job-processor.js";

const enabled = process.env.RUN_DB_INTEGRATION === "1" &&
  new URL(process.env.DATABASE_URL ?? "mysql://invalid/").pathname.endsWith("_test");

describe.skipIf(!enabled)("completed job redelivery", () => {
  const prisma = new PrismaClient();
  afterAll(async () => { await prisma.$disconnect(); });

  it("preserves the DB result after Redis loses its completed-job key", async () => {
    const key = randomUUID();
    const job = await prisma.productionJob.create({ data: {
      type: "COLLECT", queueName: "collect", idempotencyKey: key, payload: {}
    } });
    const input = { id: job.id, type: "COLLECT" as const, queueName: "collect" as const, payload: {}, runAfter: null };
    const processor = new DeterministicJobProcessor(prisma);
    await processor.process(input);
    const completed = await prisma.productionJob.findUniqueOrThrow({ where: { id: job.id }, include: { attempts: true } });
    expect(completed.status).toBe("SUCCEEDED");
    expect(completed.attempts).toHaveLength(1);
    await processor.process(input);
    const redelivered = await prisma.productionJob.findUniqueOrThrow({ where: { id: job.id }, include: { attempts: true } });
    expect(redelivered.status).toBe("SUCCEEDED");
    expect(redelivered.attempts).toHaveLength(1);
    expect(redelivered.result).toEqual(completed.result);
    expect(redelivered.finishedAt).toEqual(completed.finishedAt);
    expect(await prisma.providerUsage.count({ where: { productionJobId: job.id } })).toBe(0);
  });
});
