import { Prisma, PrismaClient } from "@prisma/client";

export { Prisma, PrismaClient };
export { assertJobScope } from "./job-scope.js";
export { settleJobReservation } from "./cost-settlement.js";
export { resolveSharedOAuthCredential, OAuthReauthenticationRequired } from "./oauth-refresh.js";
export { assertExecutionOwner, jobExecution } from "./job-execution.js";

export type DatabaseClient = PrismaClient;
export type TransactionClient = Prisma.TransactionClient;

export const createPrismaClient = (): PrismaClient =>
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"]
  });

export const withTransaction = async <Result>(
  client: PrismaClient,
  operation: (tx: TransactionClient) => Promise<Result>
): Promise<Result> => client.$transaction(operation);
