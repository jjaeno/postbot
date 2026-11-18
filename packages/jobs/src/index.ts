import { Queue, Worker, type JobsOptions, type Processor } from "bullmq";
import { Redis } from "ioredis";
import { z } from "zod";
export { DelayedError } from "bullmq";
export { productionJobRequestIntent, jobDomainPayload } from "./intent.js";

export const jobQueueNames = ["collect", "script", "asset", "tts", "render", "policy", "publish", "analytics"] as const;
export const jobTypes = ["COLLECT", "SCRIPT", "ASSET", "TTS", "RENDER", "POLICY", "PUBLISH", "ANALYTICS"] as const;
export const terminalJobStatuses = ["SUCCEEDED", "FAILED", "CANCELLED"] as const;

export const JobQueueNameSchema = z.enum(jobQueueNames);
export const JobTypeSchema = z.enum(jobTypes);
export const JobPayloadSchema = z.record(z.string(), z.unknown());

export type JobQueueName = z.infer<typeof JobQueueNameSchema>;
export type JobType = z.infer<typeof JobTypeSchema>;
export type JobPayload = z.infer<typeof JobPayloadSchema>;
export type TerminalJobStatus = (typeof terminalJobStatuses)[number];

export type JobProgressEvent = {
  id: string;
  jobId: string;
  status: string;
  attemptNumber: number | null;
  progress: number;
  message: string;
  createdAt: string;
};

export type EnqueueJobInput = {
  id: string;
  type: JobType;
  queueName: JobQueueName;
  payload: JobPayload;
  runAfter: Date | null;
};

export type QueueAdapter = {
  enqueue(input: EnqueueJobInput): Promise<void>;
  cancel(jobId: string, queueName: JobQueueName): Promise<void>;
  state?(jobId: string, queueName: JobQueueName): Promise<string>;
  close(): Promise<void>;
};

export type WorkerAdapter = {
  isHealthy(): Promise<boolean>;
  close(): Promise<void>;
  onModuleDestroy(): Promise<void>;
};

export type MaintenanceJobInput = {
  requestId: string;
};

export type MaintenanceQueueAdapter = {
  enqueue(input: MaintenanceJobInput): Promise<void>;
  close(): Promise<void>;
};

export type DeterministicWorkerInstruction =
  | { outcome: "success"; progress?: number[] }
  | { outcome: "retry-then-success"; failAttempts: number; progress?: number[] }
  | { outcome: "fail"; errorCode?: string; message?: string }
  | { outcome: "timeout"; timeoutMs?: number };

export const queueNameForJobType = (type: JobType): JobQueueName => type.toLowerCase() as JobQueueName;

export const createRedisConnection = (redisUrl: string): Redis =>
  new Redis(redisUrl, {
    maxRetriesPerRequest: null
  });

export const defaultJobOptions = (input: EnqueueJobInput): JobsOptions => ({
  jobId: input.id,
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 1_000
  },
  delay: input.runAfter ? Math.max(input.runAfter.getTime() - Date.now(), 0) : 0,
  removeOnComplete: false,
  removeOnFail: false
});

const startWorker = <Payload>(worker: Worker<Payload>): void => {
  // A synchronous close must win over startup, before BullMQ starts its timers.
  queueMicrotask(() => {
    if (worker.closing) return;
    void worker.run().catch((error: unknown) => worker.emit("error", error instanceof Error ? error : new Error("Worker run failed", { cause: error })));
  });
};

export class BullMqQueueAdapter implements QueueAdapter {
  private readonly queues = new Map<JobQueueName, Queue<EnqueueJobInput>>();
  private readonly connections = new Map<JobQueueName, Redis>();

  constructor(private readonly redisUrl: string, private readonly prefix = "bull") {}

  async state(jobId: string, queueName: JobQueueName): Promise<string> {
    return (await this.getQueue(queueName).getJob(jobId))?.getState() ?? "unknown";
  }

  async enqueue(input: EnqueueJobInput): Promise<void> {
    const queue = this.getQueue(input.queueName);
    const existing = await queue.getJob(input.id);
    if (existing) {
      const state = await existing.getState();
      if (state === "completed" || state === "failed") {
        // BullMQ atomically checks the terminal state before moving it to wait.
        // Concurrent recovery calls cannot remove a newly active job.
        try { await existing.retry(state); }
        catch (error) {
          const current = await existing.getState();
          if (current === state) throw error;
        }
        return;
      }
      if (state !== "unknown") return;
    }
    await queue.add(input.type, input, defaultJobOptions(input));
  }

  async cancel(jobId: string, queueName: JobQueueName): Promise<void> {
    const job = await this.getQueue(queueName).getJob(jobId);
    if (!job) {
      return;
    }
    if (await job.isActive()) return; // The worker observes CANCEL_REQUESTED.
    try { await job.remove(); }
    catch (error) { if (!(await job.isActive())) throw error; }
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.entries()].map(async ([name, queue]) => {
      try { await queue.close(); }
      finally { this.connections.get(name)?.disconnect(); }
    }));
  }

  onModuleDestroy(): Promise<void> { return this.close(); }

  private getQueue(queueName: JobQueueName): Queue<EnqueueJobInput> {
    const existing = this.queues.get(queueName);
    if (existing) {
      return existing;
    }
    const connection = createRedisConnection(this.redisUrl);
    const queue = new Queue<EnqueueJobInput>(queueName, { connection, prefix: this.prefix });
    this.connections.set(queueName, connection);
    this.queues.set(queueName, queue);
    return queue;
  }
}

export class BullMqMaintenanceQueueAdapter implements MaintenanceQueueAdapter {
  private readonly queue: Queue<MaintenanceJobInput>;
  private readonly connection: Redis;

  constructor(redisUrl: string, prefix = "bull") {
    this.connection = createRedisConnection(redisUrl);
    this.queue = new Queue<MaintenanceJobInput>("maintenance", {
      connection: this.connection, prefix
    });
  }

  async enqueue(input: MaintenanceJobInput): Promise<void> {
    await this.queue.add("DATA_LIFECYCLE", input, {
      jobId: input.requestId,
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: false,
      removeOnFail: false
    });
  }

  async close(): Promise<void> {
    try { await this.queue.close(); }
    finally { this.connection.disconnect(); }
  }

  onModuleDestroy(): Promise<void> { return this.close(); }
}

export const createMaintenanceWorker = (
  redisUrl: string,
  processor: Processor<MaintenanceJobInput>,
  prefix = "bull"
): WorkerAdapter => {
  const connection = createRedisConnection(redisUrl);
  const worker = new Worker<MaintenanceJobInput>("maintenance", processor, {
    connection,
    prefix,
    autorun: false,
    concurrency: 1,
    lockDuration: 60_000
  });
  startWorker(worker);
  const close = async (): Promise<void> => {
    try { await worker.close(); }
    finally { connection.disconnect(); }
  };
  return { close, onModuleDestroy: close, isHealthy: async () => worker.isRunning() && !worker.isPaused() && await connection.ping() === "PONG" };
};

export const createBullMqWorkers = (
  redisUrl: string,
  processor: Processor<EnqueueJobInput>,
  queueNames: readonly JobQueueName[] = jobQueueNames,
  prefix = "bull"
): WorkerAdapter => {
  const workers = queueNames.map((queueName) => {
    const connection = createRedisConnection(redisUrl);
    const worker = new Worker<EnqueueJobInput>(queueName, processor, {
      connection,
      prefix,
      autorun: false,
      concurrency: 1,
      lockDuration: 30_000
    });
    startWorker(worker);
    return { worker, connection };
  });

  const close = async (): Promise<void> => {
    await Promise.all(workers.map(async ({ worker, connection }) => {
      try { await worker.close(); }
      finally { connection.disconnect(); }
    }));
  };
  return { close, onModuleDestroy: close, isHealthy: async () => workers.length > 0 && (await Promise.all(workers.map(async ({ worker, connection }) => worker.isRunning() && !worker.isPaused() && await connection.ping() === "PONG"))).every(Boolean) };
};
