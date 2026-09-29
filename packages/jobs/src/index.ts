import { Queue, Worker, type JobsOptions, type Processor } from "bullmq";
import { Redis } from "ioredis";
import { z } from "zod";

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
  close(): Promise<void>;
};

export type WorkerAdapter = {
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

export class BullMqQueueAdapter implements QueueAdapter {
  private readonly queues = new Map<JobQueueName, Queue<EnqueueJobInput>>();

  constructor(private readonly redisUrl: string) {}

  async enqueue(input: EnqueueJobInput): Promise<void> {
    const queue = this.getQueue(input.queueName);
    await queue.add(input.type, input, defaultJobOptions(input));
  }

  async cancel(jobId: string, queueName: JobQueueName): Promise<void> {
    const job = await this.getQueue(queueName).getJob(jobId);
    if (!job) {
      return;
    }
    await job.remove();
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
  }

  private getQueue(queueName: JobQueueName): Queue<EnqueueJobInput> {
    const existing = this.queues.get(queueName);
    if (existing) {
      return existing;
    }
    const queue = new Queue<EnqueueJobInput>(queueName, {
      connection: createRedisConnection(this.redisUrl)
    });
    this.queues.set(queueName, queue);
    return queue;
  }
}

export class BullMqMaintenanceQueueAdapter implements MaintenanceQueueAdapter {
  private readonly queue: Queue<MaintenanceJobInput>;

  constructor(redisUrl: string) {
    this.queue = new Queue<MaintenanceJobInput>("maintenance", {
      connection: createRedisConnection(redisUrl)
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
    await this.queue.close();
  }
}

export const createMaintenanceWorker = (
  redisUrl: string,
  processor: Processor<MaintenanceJobInput>
): WorkerAdapter => {
  const worker = new Worker<MaintenanceJobInput>("maintenance", processor, {
    connection: createRedisConnection(redisUrl),
    concurrency: 1,
    lockDuration: 60_000
  });
  const close = (): Promise<void> => worker.close();
  return { close, onModuleDestroy: close };
};

export const createBullMqWorkers = (
  redisUrl: string,
  processor: Processor<EnqueueJobInput>,
  queueNames: readonly JobQueueName[] = jobQueueNames
): WorkerAdapter => {
  const workers = queueNames.map(
    (queueName) =>
      new Worker<EnqueueJobInput>(queueName, processor, {
        connection: createRedisConnection(redisUrl),
        concurrency: 1,
        lockDuration: 30_000
      })
  );

  const close = async (): Promise<void> => {
      await Promise.all(workers.map((worker) => worker.close()));
  };
  return { close, onModuleDestroy: close };
};
