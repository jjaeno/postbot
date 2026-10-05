import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const enabled = process.env.RUN_DB_INTEGRATION === "1" && !!process.env.REDIS_URL &&
  new URL(process.env.DATABASE_URL ?? "mysql://invalid/").pathname.endsWith("_test");
const run = promisify(execFile);
const moduleUrl = new URL("../dist/index.js", import.meta.url).href;

describe.skipIf(!enabled)("owned Redis connection lifecycle", () => {
  it.each(["queue", "maintenanceQueue", "worker", "maintenanceWorker"] as const)(
    "allows the %s process to exit naturally after close", async (kind) => {
      const source = `
        import { randomUUID } from 'node:crypto';
        import { BullMqQueueAdapter, BullMqMaintenanceQueueAdapter, createBullMqWorkers, createMaintenanceWorker } from ${JSON.stringify(moduleUrl)};
        const url = process.env.REDIS_URL;
        const prefix = 'lifecycle-' + randomUUID();
        const kind = ${JSON.stringify(kind)};
        const adapter = kind === 'queue' ? new BullMqQueueAdapter(url, prefix)
          : kind === 'maintenanceQueue' ? new BullMqMaintenanceQueueAdapter(url, prefix)
          : kind === 'worker' ? createBullMqWorkers(url, async () => {}, ['collect'], prefix)
          : createMaintenanceWorker(url, async () => {}, prefix);
        if (kind === 'queue') {
          const id = randomUUID();
          await adapter.enqueue({ id, type:'COLLECT', queueName:'collect', payload:{}, runAfter:null });
          await adapter.cancel(id, 'collect');
        }
        await adapter.close();
        await adapter.close();
        console.log('closed');
      `;
      const result = await run(process.execPath, ["--input-type=module", "-e", source], { timeout: 5_000 });
      expect(result.stdout.trim()).toBe("closed");
    }, 10_000
  );

  it.each(["worker", "maintenanceWorker"] as const)(
    "drains a running %s and releases its producer connection", async (kind) => {
      const source = `
        import { randomUUID } from 'node:crypto';
        import { BullMqQueueAdapter, BullMqMaintenanceQueueAdapter, createBullMqWorkers, createMaintenanceWorker } from ${JSON.stringify(moduleUrl)};
        const id = randomUUID();
        let done;
        const processed = new Promise(resolve => { done = resolve; });
        const handler = async job => { if (job.id === id) done(); };
        const url = process.env.REDIS_URL;
        const prefix = 'lifecycle-' + randomUUID();
        const maintenance = ${JSON.stringify(kind)} === 'maintenanceWorker';
        const consumer = maintenance ? createMaintenanceWorker(url, handler, prefix) : createBullMqWorkers(url, handler, ['collect'], prefix);
        const producer = maintenance ? new BullMqMaintenanceQueueAdapter(url, prefix) : new BullMqQueueAdapter(url, prefix);
        await producer.enqueue(maintenance ? { requestId:id } : { id, type:'COLLECT', queueName:'collect', payload:{}, runAfter:null });
        await processed;
        await consumer.close();
        await producer.close();
        console.log('closed');
      `;
      const result = await run(process.execPath, ["--input-type=module", "-e", source], { timeout: 5_000 });
      expect(result.stdout.trim()).toBe("closed");
    }, 10_000
  );
});
