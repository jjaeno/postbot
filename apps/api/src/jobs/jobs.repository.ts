import type {
  CreateProductionJobRequest,
  JobProgressEvent,
  ProductionJobResponse,
  ProductionJobStatus
} from "@postbot/contracts";
import type { JobQueueName } from "@postbot/jobs";

export const JOBS_REPOSITORY = Symbol("JOBS_REPOSITORY");

export type CreateJobRecordInput = CreateProductionJobRequest & {
  queueName: JobQueueName;
  runAfterDate: Date | null;
};

export type CreateJobRecordResult = {
  job: ProductionJobResponse;
  created: boolean;
};

export type JobWorkerRepository = {
  start(jobId: string): Promise<number | null>;
  retry(jobId: string, attemptNumber: number, errorCode: string, errorMessage: string): Promise<void>;
  succeed(jobId: string, attemptNumber: number, result: Record<string, unknown>): Promise<void>;
  fail(jobId: string, attemptNumber: number, errorCode: string, errorMessage: string): Promise<void>;
  cancel(jobId: string, attemptNumber: number | null): Promise<void>;
};

export type JobsRepository = JobWorkerRepository & {
  createOrFind(workspaceId: string, input: CreateJobRecordInput): Promise<CreateJobRecordResult>;
  findForWorkspace(workspaceId: string, jobId: string): Promise<ProductionJobResponse | null>;
  requestCancel(workspaceId: string, jobId: string): Promise<ProductionJobResponse | null>;
  canRecoverKnownResult?(workspaceId: string, jobId: string): Promise<boolean>;
  recover(workspaceId: string, jobId: string, runAfter: Date | null): Promise<ProductionJobResponse | null>;
  toProgressEvent(job: ProductionJobResponse): JobProgressEvent;
};

export const isTerminalJobStatus = (status: ProductionJobStatus): boolean =>
  status === "SUCCEEDED" || status === "FAILED" || status === "CANCELLED";
