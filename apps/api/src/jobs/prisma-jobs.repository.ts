import { Inject, Injectable } from "@nestjs/common";
import type {
  JobAttemptResponse,
  JobProgressEvent,
  ProductionJobResponse,
  ProductionJobStatus
} from "@postbot/contracts";
import { assertJobScope, Prisma, type PrismaClient } from "@postbot/database";
import type { CreateJobRecordInput, CreateJobRecordResult, JobsRepository } from "./jobs.repository.js";

type JobWithAttempts = Prisma.ProductionJobGetPayload<{
  include: { attempts: { orderBy: { attemptNumber: "asc" } } };
}>;

const jsonObject = (value: Prisma.JsonValue): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const nullableJsonObject = (value: Prisma.JsonValue | null): Record<string, unknown> | null =>
  value === null ? null : jsonObject(value);

const payloadWithoutTrace = (value: Prisma.JsonValue | Record<string, unknown>): Record<string, unknown> => {
  const payload = jsonObject(value as Prisma.JsonValue);
  return Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "_trace"));
};

const canonicalJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, canonicalJson(nested)]));
  }
  return value;
};

const hasSameJobIntent = (job: JobWithAttempts, input: CreateJobRecordInput): boolean =>
  job.channelId === input.channelId &&
  job.contentItemId === (input.contentItemId ?? null) &&
  job.type === input.type &&
  job.queueName === input.queueName &&
  (job.runAfter?.toISOString() ?? null) === (input.runAfterDate?.toISOString() ?? null) &&
  JSON.stringify(canonicalJson(payloadWithoutTrace(job.payload))) === JSON.stringify(canonicalJson(payloadWithoutTrace(input.payload)));

const toAttemptResponse = (attempt: JobWithAttempts["attempts"][number]): JobAttemptResponse => ({
  id: attempt.id,
  attemptNumber: attempt.attemptNumber,
  status: attempt.status,
  startedAt: attempt.startedAt.toISOString(),
  finishedAt: attempt.finishedAt?.toISOString() ?? null,
  errorCode: attempt.errorCode,
  errorMessage: attempt.errorMessage
});

const toJobResponse = (job: JobWithAttempts, duplicate?: boolean): ProductionJobResponse => ({
  id: job.id,
  channelId: job.channelId,
  contentItemId: job.contentItemId,
  type: job.type,
  status: job.status,
  queueName: job.queueName,
  idempotencyKey: job.idempotencyKey,
  payload: jsonObject(job.payload),
  result: nullableJsonObject(job.result),
  errorCode: job.errorCode,
  errorMessage: job.errorMessage,
  runAfter: job.runAfter?.toISOString() ?? null,
  startedAt: job.startedAt?.toISOString() ?? null,
  finishedAt: job.finishedAt?.toISOString() ?? null,
  createdAt: job.createdAt.toISOString(),
  updatedAt: job.updatedAt.toISOString(),
  attempts: job.attempts.map(toAttemptResponse),
  duplicate
});

@Injectable()
export class PrismaJobsRepository implements JobsRepository {
  constructor(@Inject("PRISMA_CLIENT") private readonly prisma: PrismaClient) {}

  async createOrFind(workspaceId: string, input: CreateJobRecordInput): Promise<CreateJobRecordResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const channel = await tx.channel.findFirst({
          where: { id: input.channelId, workspaceId }
        });
        if (!channel) {
          throw new Error("CHANNEL_NOT_FOUND");
        }
        await assertJobScope(tx, input);
        if (input.contentItemId) {
          const contentItem = await tx.contentItem.findFirst({
            where: { id: input.contentItemId, channelId: input.channelId }
          });
          if (!contentItem) {
            throw new Error("CONTENT_ITEM_NOT_FOUND");
          }
        }

        const existing = await tx.productionJob.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
          include: { attempts: { orderBy: { attemptNumber: "asc" } } }
        });
        if (existing) {
          if (!hasSameJobIntent(existing, input)) {
            throw new Error("IDEMPOTENCY_CONFLICT");
          }
          return { job: toJobResponse(existing, true), created: false };
        }

        const created = await tx.productionJob.create({
          data: {
            channelId: input.channelId,
            contentItemId: input.contentItemId,
            type: input.type,
            status: "QUEUED",
            queueName: input.queueName,
            idempotencyKey: input.idempotencyKey,
            payload: input.payload as Prisma.InputJsonObject,
            runAfter: input.runAfterDate
          }
        });
        const createdWithAttempts = await tx.productionJob.findUniqueOrThrow({
          where: { id: created.id },
          include: { attempts: { orderBy: { attemptNumber: "asc" } } }
        });
        return { job: toJobResponse(createdWithAttempts, false), created: true };
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        throw error;
      }
      const existing = await this.prisma.productionJob.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: { attempts: { orderBy: { attemptNumber: "asc" } } }
      });
      if (!existing || !hasSameJobIntent(existing, input)) {
        throw new Error("IDEMPOTENCY_CONFLICT");
      }
      return { job: toJobResponse(existing, true), created: false };
    }
  }

  async findForWorkspace(workspaceId: string, jobId: string): Promise<ProductionJobResponse | null> {
    const job = await this.prisma.productionJob.findFirst({
      where: {
        id: jobId,
        channel: { workspaceId }
      },
      include: { attempts: { orderBy: { attemptNumber: "asc" } } }
    });
    return job ? toJobResponse(job) : null;
  }

  async requestCancel(workspaceId: string, jobId: string): Promise<ProductionJobResponse | null> {
    const existing = await this.findForWorkspace(workspaceId, jobId);
    if (!existing) {
      return null;
    }
    if (existing.status === "SUCCEEDED" || existing.status === "FAILED" || existing.status === "CANCELLED") {
      return existing;
    }
    await this.prisma.productionJob.updateMany({
      where: { id: jobId, status: { notIn: ["SUCCEEDED", "FAILED", "CANCELLED"] } },
      data: {
        status: "CANCEL_REQUESTED",
        errorCode: null,
        errorMessage: null
      }
    });
    return this.findForWorkspace(workspaceId, jobId);
  }

  async recover(workspaceId: string, jobId: string, runAfter: Date | null): Promise<ProductionJobResponse | null> {
    const existing = await this.findForWorkspace(workspaceId, jobId);
    if (!existing) {
      return null;
    }
    if (!["FAILED", "CANCELLED", "NEEDS_REVIEW"].includes(existing.status)) {
      return existing;
    }
    if (existing.result?.reconciliationRequired === true || existing.errorCode?.includes("RECONCILIATION_REQUIRED")) throw new Error("RECONCILIATION_REQUIRED");
    await this.prisma.productionJob.updateMany({
      where: { id: jobId, status: existing.status, updatedAt: new Date(existing.updatedAt) },
      data: {
        status: "QUEUED",
        runAfter: runAfter ?? (existing.runAfter ? new Date(existing.runAfter) : null),
        startedAt: null,
        finishedAt: null,
        errorCode: null,
        errorMessage: null
      }
    });
    return this.findForWorkspace(workspaceId, jobId);
  }

  async start(jobId: string): Promise<number | null> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM production_jobs WHERE id = ${jobId} FOR UPDATE`;
      const job = await tx.productionJob.findUnique({
        where: { id: jobId },
        include: { attempts: { orderBy: { attemptNumber: "desc" }, take: 1 } }
      });
      if (!job || !["QUEUED", "RETRY_WAIT", "FAILED"].includes(job.status)) {
        return null;
      }
      const attemptNumber = (job.attempts[0]?.attemptNumber ?? 0) + 1;
      await tx.jobAttempt.create({
        data: {
          productionJobId: jobId,
          attemptNumber,
          status: "RUNNING"
        }
      });
      await tx.productionJob.update({
        where: { id: jobId },
        data: {
          status: "RUNNING",
          startedAt: new Date(),
          errorCode: null,
          errorMessage: null
        }
      });
      return attemptNumber;
    });
  }

  async retry(jobId: string, attemptNumber: number, errorCode: string, errorMessage: string): Promise<void> {
    await this.finishAttempt(jobId, attemptNumber, "RETRY_WAIT", {
      status: "RETRY_WAIT",
      errorCode,
      errorMessage
    });
  }

  async succeed(jobId: string, attemptNumber: number, result: Record<string, unknown>): Promise<void> {
    await this.finishAttempt(jobId, attemptNumber, "SUCCEEDED", {
      status: "SUCCEEDED",
      result: result as Prisma.InputJsonObject,
      finishedAt: new Date(),
      errorCode: null,
      errorMessage: null
    });
  }

  async fail(jobId: string, attemptNumber: number, errorCode: string, errorMessage: string): Promise<void> {
    await this.finishAttempt(jobId, attemptNumber, "FAILED", {
      status: "FAILED",
      finishedAt: new Date(),
      errorCode,
      errorMessage
    });
  }

  async cancel(jobId: string, attemptNumber: number | null): Promise<void> {
    if (attemptNumber) {
      await this.finishAttempt(jobId, attemptNumber, "CANCELLED", {
        status: "CANCELLED",
        finishedAt: new Date(),
        errorCode: "JOB_CANCELLED",
        errorMessage: "Job was cancelled."
      });
      return;
    }
    await this.prisma.productionJob.update({
      where: { id: jobId },
      data: {
        status: "CANCELLED",
        finishedAt: new Date(),
        errorCode: "JOB_CANCELLED",
        errorMessage: "Job was cancelled."
      }
    });
  }

  toProgressEvent(job: ProductionJobResponse): JobProgressEvent {
    const latestAttempt = job.attempts.at(-1) ?? null;
    const progress = this.progressForStatus(job.status);
    return {
      id: `${job.id}:${job.updatedAt}:${latestAttempt?.attemptNumber ?? 0}`,
      jobId: job.id,
      status: job.status,
      attemptNumber: latestAttempt?.attemptNumber ?? null,
      progress,
      message: this.messageForStatus(job.status),
      createdAt: new Date().toISOString()
    };
  }

  private async finishAttempt(
    jobId: string,
    attemptNumber: number,
    attemptStatus: ProductionJobStatus,
    jobData: Prisma.ProductionJobUpdateInput
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.jobAttempt.update({
        where: {
          productionJobId_attemptNumber: {
            productionJobId: jobId,
            attemptNumber
          }
        },
        data: {
          status: attemptStatus,
          finishedAt: new Date(),
          errorCode: typeof jobData.errorCode === "string" ? jobData.errorCode : null,
          errorMessage: typeof jobData.errorMessage === "string" ? jobData.errorMessage : null
        }
      }),
      this.prisma.productionJob.update({
        where: { id: jobId },
        data: jobData
      })
    ]);
  }

  private progressForStatus(status: ProductionJobStatus): number {
    switch (status) {
      case "QUEUED":
        return 0;
      case "RUNNING":
        return 50;
      case "RETRY_WAIT":
        return 25;
      case "CANCEL_REQUESTED":
      case "NEEDS_REVIEW":
        return 75;
      case "SUCCEEDED":
      case "FAILED":
      case "CANCELLED":
        return 100;
    }
  }

  private messageForStatus(status: ProductionJobStatus): string {
    switch (status) {
      case "QUEUED":
        return "Job is queued.";
      case "RUNNING":
        return "Job is running.";
      case "RETRY_WAIT":
        return "Job is waiting for retry.";
      case "NEEDS_REVIEW":
        return "Job needs manual review.";
      case "SUCCEEDED":
        return "Job succeeded.";
      case "FAILED":
        return "Job failed.";
      case "CANCEL_REQUESTED":
        return "Job cancellation was requested.";
      case "CANCELLED":
        return "Job was cancelled.";
    }
  }
}
