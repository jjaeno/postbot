import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  CreateProductionJobRequestSchema,
  RecoverProductionJobRequestSchema,
  type CreateProductionJobRequest,
  type JobProgressEvent,
  type ProductionJobResponse,
  type RecoverProductionJobRequest
} from "@postbot/contracts";
import { BullMqQueueAdapter, queueNameForJobType, type QueueAdapter } from "@postbot/jobs";
import { loadConfig } from "@postbot/config";
import { isTerminalJobStatus, JOBS_REPOSITORY, type JobsRepository } from "./jobs.repository.js";

export const QUEUE_ADAPTER = Symbol("QUEUE_ADAPTER");

const parseRunAfter = (runAfter: string | undefined): Date | null => (runAfter ? new Date(runAfter) : null);

@Injectable()
export class JobsService {
  constructor(
    @Inject(JOBS_REPOSITORY) private readonly repository: JobsRepository,
    @Inject(QUEUE_ADAPTER) private readonly queue: QueueAdapter
  ) {}

  async create(workspaceId: string, rawInput: unknown): Promise<ProductionJobResponse> {
    const input = this.parseCreateInput(rawInput);
    try {
      const result = await this.repository.createOrFind(workspaceId, {
        ...input,
        queueName: queueNameForJobType(input.type),
        runAfterDate: parseRunAfter(input.runAfter)
      });
      if (result.created) {
        await this.queue.enqueue({
          id: result.job.id,
          type: result.job.type,
          queueName: queueNameForJobType(result.job.type),
          payload: result.job.payload,
          runAfter: parseRunAfter(result.job.runAfter ?? undefined)
        });
      }
      return result.job;
    } catch (error) {
      throw this.toHttpError(error);
    }
  }

  async get(workspaceId: string, jobId: string): Promise<ProductionJobResponse> {
    const job = await this.repository.findForWorkspace(workspaceId, jobId);
    if (!job) {
      throw new NotFoundException({ code: "JOB_NOT_FOUND", message: "Job was not found." });
    }
    return job;
  }

  async cancel(workspaceId: string, jobId: string): Promise<ProductionJobResponse> {
    const job = await this.repository.requestCancel(workspaceId, jobId);
    if (!job) {
      throw new NotFoundException({ code: "JOB_NOT_FOUND", message: "Job was not found." });
    }
    await this.queue.cancel(job.id, queueNameForJobType(job.type));
    if (job.status === "CANCEL_REQUESTED") {
      await this.repository.cancel(job.id, job.attempts.at(-1)?.attemptNumber ?? null);
      return this.get(workspaceId, jobId);
    }
    return job;
  }

  async recover(workspaceId: string, jobId: string, rawInput: unknown): Promise<ProductionJobResponse> {
    const input = RecoverProductionJobRequestSchema.parse(rawInput) satisfies RecoverProductionJobRequest;
    const job = await this.repository.recover(workspaceId, jobId, parseRunAfter(input.runAfter));
    if (!job) {
      throw new NotFoundException({ code: "JOB_NOT_FOUND", message: "Job was not found." });
    }
    if (job.status === "QUEUED") {
      await this.queue.enqueue({
        id: job.id,
        type: job.type,
        queueName: queueNameForJobType(job.type),
        payload: job.payload,
        runAfter: parseRunAfter(job.runAfter ?? undefined)
      });
    }
    return job;
  }

  async progressEvent(workspaceId: string, jobId: string): Promise<JobProgressEvent> {
    const job = await this.get(workspaceId, jobId);
    return this.repository.toProgressEvent(job);
  }

  isTerminal(job: ProductionJobResponse): boolean {
    return isTerminalJobStatus(job.status);
  }

  private parseCreateInput(rawInput: unknown): CreateProductionJobRequest {
    try {
      return CreateProductionJobRequestSchema.parse(rawInput);
    } catch {
      throw new BadRequestException({ code: "INVALID_JOB_INPUT", message: "Invalid job request." });
    }
  }

  private toHttpError(error: unknown): Error {
    if (!(error instanceof Error)) {
      return new BadRequestException({ code: "JOB_CREATE_FAILED", message: "Job could not be created." });
    }
    if (error.message === "CHANNEL_NOT_FOUND" || error.message === "CONTENT_ITEM_NOT_FOUND") {
      return new ForbiddenException({ code: error.message, message: "The requested resource is not in this workspace." });
    }
    if (error.message === "IDEMPOTENCY_CONFLICT") {
      return new BadRequestException({ code: "IDEMPOTENCY_CONFLICT", message: "Idempotency key conflicts with another job." });
    }
    return error;
  }
}

export const createBullMqQueueAdapter = (): QueueAdapter => new BullMqQueueAdapter(loadConfig().REDIS_URL);
