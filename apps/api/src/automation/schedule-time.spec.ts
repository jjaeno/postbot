import { describe, expect, it } from "vitest";
import { nextZonedSchedule } from "./schedule-time.js";

describe("recurring local schedules", () => {
  it("keeps the Seoul weekday when its occurrence is on the previous UTC day", () => {
    expect(nextZonedSchedule([{ dayOfWeek: 1, timeOfDayUtc: "00:30:00", timezone: "Asia/Seoul" }], new Date("2026-10-04T14:00:00Z"))?.toISOString()).toBe("2026-10-04T15:30:00.000Z");
  });
  it("resolves daylight-saving offsets for the occurrence date", () => {
    expect(nextZonedSchedule([{ dayOfWeek: 1, timeOfDayUtc: "09:00:00", timezone: "America/New_York" }], new Date("2026-11-01T12:00:00Z"))?.toISOString()).toBe("2026-11-02T14:00:00.000Z");
  });
});
