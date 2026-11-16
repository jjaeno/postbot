import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type {
  CreateProductionJobRequest,
  JobProgressEvent,
  ProductionJobResponse,
  ProductionJobStatus
} from "@postbot/contracts";
import type { EnqueueJobInput, QueueAdapter } from "@postbot/jobs";
import { beforeEach, describe, expect, it } from "vitest";
import type { CreateJobRecordInput, CreateJobRecordResult, JobsRepository } from "./jobs.repository.js";
import { JobsService } from "./jobs.service.js";

type AttemptRecord = ProductionJobResponse["attempts"][number];

class MemoryQueueAdapter implements QueueAdapter {
  readonly enqueued: EnqueueJobInput[] = [];
  readonly cancelled: string[] = [];

  enqueue(input: EnqueueJobInput): Promise<void> {
    this.enqueued.push(input);
    return Promise.resolve();
  }

  cancel(jobId: string): Promise<void> {
    this.cancelled.push(jobId);
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

class MemoryJobsRepository implements JobsRepository {
  readonly allowedChannels = new Map<string, string>();
  readonly jobs = new Map<string, ProductionJobResponse>();
  private sequence = 0;

  allow(workspaceId: string, channelId: string): void {
    this.allowedChannels.set(channelId, workspaceId);
  }

  createOrFind(workspaceId: string, input: CreateJobRecordInput): Promise<CreateJobRecordResult> {
    if (this.allowedChannels.get(input.channelId) !== workspaceId) {
      throw new Error("CHANNEL_NOT_FOUND");
    }
    const existing = [...this.jobs.values()].find((job) => job.idempotencyKey === input.idempotencyKey);
    if (existing) {
      return Promise.resolve({ job: { ...existing, duplicate: true }, created: false });
    }
    const now = new Date().toISOString();
    const job: ProductionJobResponse = {
      id: `job-${++this.sequence}`,
      channelId: input.channelId,
      contentItemId: input.contentItemId ?? null,
      type: input.type,
      status: "QUEUED",
      queueName: input.queueName,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload,
      result: null,
      errorCode: null,
      errorMessage: null,
      runAfter: input.runAfterDate?.toISOString() ?? null,
      startedAt: null,
      finishedAt: null,
      createdAt: now,
      updatedAt: now,
      attempts: [],
      duplicate: false
    };
    this.jobs.set(job.id, job);
    return Promise.resolve({ job, created: true });
  }

  findForWorkspace(workspaceId: string, jobId: string): Promise<ProductionJobResponse | null> {
    const job = this.jobs.get(jobId);
    if (!job || !job.channelId || this.allowedChannels.get(job.channelId) !== workspaceId) {
      return Promise.resolve(null);
    }
    return Promise.resolve(job);
  }

  requestCancel(workspaceId: string, jobId: string): Promise<ProductionJobResponse | null> {
    const job = this.jobs.get(jobId);
    if (!job || !job.channelId || this.allowedChannels.get(job.channelId) !== workspaceId) {
      return Promise.resolve(null);
    }
    if (!["SUCCEEDED", "FAILED", "CANCELLED"].includes(job.status)) {
      this.update(jobId, { status: "CANCEL_REQUESTED" });
    }
    return Promise.resolve(this.jobs.get(jobId) ?? null);
  }

  recover(workspaceId: string, jobId: string, runAfter: Date | null): Promise<ProductionJobResponse | null> {
    const job = this.jobs.get(jobId);
    if (!job || !job.channelId || this.allowedChannels.get(job.channelId) !== workspaceId) {
      return Promise.resolve(null);
    }
    if (["FAILED", "CANCELLED", "NEEDS_REVIEW"].includes(job.status)) {
      this.update(jobId, {
        status: "QUEUED",
        runAfter: runAfter?.toISOString() ?? null,
        errorCode: null,
        errorMessage: null,
        finishedAt: null
      });
    }
    return Promise.resolve(this.jobs.get(jobId) ?? null);
  }

  start(jobId: string): Promise<number | null> {
    const job = this.jobs.get(jobId);
    if (!job || job.status === "CANCEL_REQUESTED" || job.status === "CANCELLED") {
      return Promise.resolve(null);
    }
    const attemptNumber = (job.attempts.at(-1)?.attemptNumber ?? 0) + 1;
    const attempt: AttemptRecord = {
      id: `attempt-${jobId}-${attemptNumber}`,
      attemptNumber,
      status: "RUNNING",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      errorCode: null,
      errorMessage: null
    };
    this.update(jobId, { status: "RUNNING", startedAt: new Date().toISOString(), attempts: [...job.attempts, attempt] });
    return Promise.resolve(attemptNumber);
  }

  retry(jobId: string, attemptNumber: number, errorCode: string, errorMessage: string): Promise<void> {
    this.finish(jobId, attemptNumber, "RETRY_WAIT", { status: "RETRY_WAIT", errorCode, errorMessage });
    return Promise.resolve();
  }

  succeed(jobId: string, attemptNumber: number, result: Record<string, unknown>): Promise<void> {
    this.finish(jobId, attemptNumber, "SUCCEEDED", {
      status: "SUCCEEDED",
      result,
      finishedAt: new Date().toISOString(),
      errorCode: null,
      errorMessage: null
    });
    return Promise.resolve();
  }

  fail(jobId: string, attemptNumber: number, errorCode: string, errorMessage: string): Promise<void> {
    this.finish(jobId, attemptNumber, "FAILED", {
      status: "FAILED",
      finishedAt: new Date().toISOString(),
      errorCode,
      errorMessage
    });
    return Promise.resolve();
  }

  cancel(jobId: string, attemptNumber: number | null): Promise<void> {
    if (attemptNumber === null) {
      this.update(jobId, {
        status: "CANCELLED",
        finishedAt: new Date().toISOString(),
        errorCode: "JOB_CANCELLED",
        errorMessage: "Job was cancelled."
      });
      return Promise.resolve();
    }
    this.finish(jobId, attemptNumber, "CANCELLED", {
      status: "CANCELLED",
      finishedAt: new Date().toISOString(),
      errorCode: "JOB_CANCELLED",
      errorMessage: "Job was cancelled."
    });
    return Promise.resolve();
  }

  toProgressEvent(job: ProductionJobResponse): JobProgressEvent {
    return {
      id: `${job.id}:${job.updatedAt}`,
      jobId: job.id,
      status: job.status,
      attemptNumber: job.attempts.at(-1)?.attemptNumber ?? null,
      progress: ["SUCCEEDED", "FAILED", "CANCELLED"].includes(job.status) ? 100 : 50,
      message: job.status,
      createdAt: new Date().toISOString()
    };
  }

  private finish(
    jobId: string,
    attemptNumber: number,
    status: ProductionJobStatus,
    patch: Partial<ProductionJobResponse>
  ): void {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }
    const attempts = job.attempts.map((attempt) =>
      attempt.attemptNumber === attemptNumber
        ? {
            ...attempt,
            status,
            finishedAt: new Date().toISOString(),
            errorCode: patch.errorCode ?? null,
            errorMessage: patch.errorMessage ?? null
          }
        : attempt
    );
    this.update(jobId, { ...patch, attempts });
  }

  private update(jobId: string, patch: Partial<ProductionJobResponse>): void {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }
    this.jobs.set(jobId, {
      ...job,
      ...patch,
      updatedAt: new Date().toISOString()
    });
  }
}

const createJobInput = (overrides: Partial<CreateProductionJobRequest> = {}): CreateProductionJobRequest => ({
  type: "SCRIPT",
  channelId: "channel-1",
  idempotencyKey: `idempotency-${crypto.randomUUID()}`,
  payload: {},
  ...overrides
});

const createHarness = () => {
  const repository = new MemoryJobsRepository();
  const queue = new MemoryQueueAdapter();
  repository.allow("workspace-1", "channel-1");
  const service = new JobsService(repository, queue);
  return { queue, repository, service };
};

const runDeterministicWorker = async (
  repository: JobsRepository,
  jobId: string,
  behavior: "success" | "retry-success" | "fail" = "success"
): Promise<void> => {
  const firstAttempt = await repository.start(jobId);
  if (firstAttempt === null) {
    await repository.cancel(jobId, null);
    return;
  }
  if (behavior === "fail") {
    await repository.fail(jobId, firstAttempt, "PERMANENT_FAILURE", "Permanent failure.");
    return;
  }
  if (behavior === "retry-success") {
    await repository.retry(jobId, firstAttempt, "TRANSIENT_FAILURE", "Transient failure.");
    const secondAttempt = await repository.start(jobId);
    if (secondAttempt === null) {
      throw new Error("Expected retry attempt to start.");
    }
    await repository.succeed(jobId, secondAttempt, { ok: true });
    return;
  }
  await repository.succeed(jobId, firstAttempt, { ok: true });
};

describe("JobsService", () => {
  beforeEach(() => {
    process.env.REDIS_URL = "redis://localhost:6379";
  });

  it("persists dependent records before enqueue and does not enqueue when that fails", async () => {
    const { queue, service } = createHarness();
    const input = createJobInput();
    await expect(service.create("workspace-1", input, () => {
      expect(queue.enqueued).toHaveLength(0);
      return Promise.reject(new Error("DEPENDENT_RECORD_FAILED"));
    })).rejects.toThrow("DEPENDENT_RECORD_FAILED");
    expect(queue.enqueued).toHaveLength(0);
    await service.create("workspace-1", input, (job) => {
      expect(job.id).toBe("job-1");
      expect(queue.enqueued).toHaveLength(0);
      return Promise.resolve();
    });
    expect(queue.enqueued).toHaveLength(1);
  });

  it("returns a job id immediately and completes successful deterministic work", async () => {
    const { queue, repository, service } = createHarness();
    const created = await service.create("workspace-1", createJobInput());

    expect(created.id).toBe("job-1");
    expect(created.status).toBe("QUEUED");
    expect(queue.enqueued).toHaveLength(1);

    await runDeterministicWorker(repository, created.id);
    await expect(service.get("workspace-1", created.id)).resolves.toMatchObject({ status: "SUCCEEDED" });
  });

  it("records retry success attempts", async () => {
    const { repository, service } = createHarness();
    const created = await service.create("workspace-1", createJobInput());

    await runDeterministicWorker(repository, created.id, "retry-success");
    const completed = await service.get("workspace-1", created.id);

    expect(completed.status).toBe("SUCCEEDED");
    expect(completed.attempts.map((attempt) => attempt.status)).toEqual(["RETRY_WAIT", "SUCCEEDED"]);
  });

  it("records permanent failure for dead-letter recovery", async () => {
    const { repository, service } = createHarness();
    const created = await service.create("workspace-1", createJobInput());

    await runDeterministicWorker(repository, created.id, "fail");
    const failed = await service.get("workspace-1", created.id);

    expect(failed.status).toBe("FAILED");
    expect(failed.errorCode).toBe("PERMANENT_FAILURE");
  });

  it("deduplicates repeated create requests by idempotency key", async () => {
    const { queue, service } = createHarness();
    const input = createJobInput({ idempotencyKey: "same-idempotency-key" });

    const first = await service.create("workspace-1", input);
    const second = await service.create("workspace-1", input);

    expect(second.id).toBe(first.id);
    expect(second.duplicate).toBe(true);
    // A duplicate request also repairs an interrupted DB-to-Redis handoff.
    expect(queue.enqueued.map((job) => job.id)).toEqual([first.id, first.id]);
  });

  it("cancels queued work", async () => {
    const { queue, service } = createHarness();
    const created = await service.create("workspace-1", createJobInput());

    const cancelled = await service.cancel("workspace-1", created.id);

    expect(cancelled.status).toBe("CANCELLED");
    expect(queue.cancelled).toEqual([created.id]);
  });

  it("recovers failed work after a worker restart", async () => {
    const { queue, repository, service } = createHarness();
    const created = await service.create("workspace-1", createJobInput());
    await runDeterministicWorker(repository, created.id, "fail");

    const recovered = await service.recover("workspace-1", created.id, {});

    expect(recovered.status).toBe("QUEUED");
    expect(queue.enqueued.map((job) => job.id)).toEqual([created.id, created.id]);
  });

  it("supports SSE reconnection from persisted REST state", async () => {
    const { repository, service } = createHarness();
    const created = await service.create("workspace-1", createJobInput());
    const firstEvent = await service.progressEvent("workspace-1", created.id);

    await runDeterministicWorker(repository, created.id);
    const reconnectEvent = await service.progressEvent("workspace-1", created.id);

    expect(firstEvent.status).toBe("QUEUED");
    expect(reconnectEvent.status).toBe("SUCCEEDED");
    expect(reconnectEvent.progress).toBe(100);
  });

  it("enforces workspace authorization for job access", async () => {
    const { service } = createHarness();

    await expect(service.create("workspace-2", createJobInput())).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.get("workspace-2", "job-1")).rejects.toBeInstanceOf(NotFoundException);
  });
});
