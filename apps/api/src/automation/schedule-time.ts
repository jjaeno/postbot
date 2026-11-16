export type RecurringSchedule = { dayOfWeek: number; timeOfDayUtc: string; timezone?: string; maxPosts?: number };

// ScheduleRule stores the user's wall-clock time in its legacy timeOfDayUtc column.
// Resolve each occurrence using the zone's offset on that date, including DST.
export const nextZonedSchedule = (rules: readonly RecurringSchedule[], after: Date): Date | null => {
  const candidates: Date[] = [];
  for (const rule of rules) {
    const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: rule.timezone ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    const localParts = (date: Date) => {
      const parts = formatter.formatToParts(date);
      const value = (key: Intl.DateTimeFormatPartTypes): number => {
        const part = parts.find((entry) => entry.type === key);
        if (!part) throw new Error("INVALID_SCHEDULE_TIMEZONE");
        return Number(part.value);
      };
      return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute"), second: value("second") };
    };
    const base = localParts(after);
    const [hour = 0, minute = 0, second = 0] = rule.timeOfDayUtc.split(":").map(Number);
    for (let offset = 0; offset <= 8; offset += 1) {
      const wall = new Date(Date.UTC(base.year, base.month - 1, base.day + offset, hour, minute, second));
      if (wall.getUTCDay() !== rule.dayOfWeek) continue;
      let instant = wall.getTime();
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const local = localParts(new Date(instant));
        instant += wall.getTime() - Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
      }
      const candidate = new Date(instant);
      const resolved = localParts(candidate);
      // Nonexistent times in spring-forward gaps are not silently moved.
      if (resolved.hour === hour && resolved.minute === minute && resolved.day === wall.getUTCDate()) {
        for (let index = 0; index < (rule.maxPosts ?? 1); index += 1) {
          const slot = new Date(candidate.getTime() + index * 60_000);
          if (slot.getTime() > after.getTime() + 1_000) candidates.push(slot);
        }
      }
    }
  }
  return candidates.sort((left, right) => left.getTime() - right.getTime())[0] ?? null;
};
