import type { Request } from "express";
import type { AuthSession } from "@postbot/contracts";

export type CookieRequest = Omit<Request, "cookies"> & {
  cookies?: Record<string, string | undefined>;
};

export type AuthenticatedRequest = CookieRequest & {
  auth: AuthSession & {
    userId: string;
    workspaceId: string;
  };
};
