import type { Response } from "express";
import { describe, expect, it, vi } from "vitest";
import type { OAuthCallbackResult } from "@postbot/contracts";
import { PlatformAccountsController } from "./platform-accounts.controller.js";
import type { PlatformAccountsService } from "./platform-accounts.service.js";
import type { OperationsService } from "../operations/operations.service.js";

describe("browser OAuth return", () => {
  it("returns successful browsers to the trusted frontend and original channel", async () => {
    const redirect = vi.fn();
    const result = { account: { channelId: "channel-1" } } as OAuthCallbackResult;
    const controller = new PlatformAccountsController({ completeYouTube: () => Promise.resolve(result) } as unknown as PlatformAccountsService, {} as OperationsService);
    await controller.completeYouTube({}, "text/html", { redirect } as unknown as Response);
    const target = new URL(redirect.mock.calls[0]?.[1] as string);
    expect(target.searchParams.get("oauth")).toBe("connected"); expect(target.searchParams.get("channel")).toBe("channel-1"); expect(target.hash).toBe("#channels");
  });
  it("does not reflect credentials or provider failure text into redirect URLs", async () => {
    const redirect = vi.fn();
    const controller = new PlatformAccountsController({ completeYouTube: () => Promise.reject(new Error("sensitive-provider-message")) } as unknown as PlatformAccountsService, {} as OperationsService);
    await controller.completeYouTube({}, "text/html", { redirect } as unknown as Response);
    expect(redirect.mock.calls[0]?.[1]).toContain("oauth=failed"); expect(redirect.mock.calls[0]?.[1]).not.toContain("sensitive-provider-message");
    await expect(controller.completeYouTube({}, "application/json", { redirect } as unknown as Response)).rejects.toThrow("sensitive-provider-message");
  });
});
