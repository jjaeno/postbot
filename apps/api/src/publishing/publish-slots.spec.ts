import { describe, expect, it } from "vitest";
import { localPublishDay } from "./publish-slots.js";

describe("platform daily quota dates", () => {
  it("counts Seoul posts on the local date across the UTC boundary", () => {
    expect(localPublishDay(new Date("2026-10-04T15:30:00Z"), "Asia/Seoul")).toBe("2026-10-05");
    expect(localPublishDay(new Date("2026-10-05T14:59:00Z"), "Asia/Seoul")).toBe("2026-10-05");
    expect(localPublishDay(new Date("2026-10-05T15:00:00Z"), "Asia/Seoul")).toBe("2026-10-06");
  });
});
