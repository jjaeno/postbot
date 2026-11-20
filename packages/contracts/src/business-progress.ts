import { z } from "zod";
export const BusinessProgressSchema = z.object({ state: z.string(), reason: z.string(), cadenceMinutes: z.number(), graceMinutes: z.number(), expectedAt: z.string().nullable(), lastAttemptAt: z.string().nullable(), lastSuccessAt: z.string().nullable(), delayMinutes: z.number() });
export type BusinessProgress = z.infer<typeof BusinessProgressSchema>;
export function evaluateBusinessProgress(input: {
  now: Date; createdAt: Date; active: boolean; cadenceMinutes: number; configured: boolean;
  lastAttemptAt: Date | null; lastSuccessAt: Date | null; blocker?: string | null;
  inProgress?: boolean; inventorySatisfied?: boolean; zeroCandidates?: boolean;
}): BusinessProgress {
  const cadenceMinutes = Math.max(5, input.cadenceMinutes); const graceMinutes = cadenceMinutes + 15;
  const expected = new Date((input.lastSuccessAt ?? input.createdAt).getTime() + cadenceMinutes * 60000);
  const delayMinutes = Math.max(0, Math.floor((input.now.getTime() - expected.getTime()) / 60000));
  const state = !input.active ? "INTENTIONALLY_PAUSED" : !input.configured ? "NOT_CONFIGURED" : input.blocker ? input.blocker : input.inventorySatisfied ? "INVENTORY_SATISFIED" : input.inProgress ? "IN_PROGRESS" : input.now.getTime() <= expected.getTime() + graceMinutes * 60000 ? input.lastSuccessAt ? "AWAITING_NEXT_CYCLE" : "INITIAL_GRACE" : input.zeroCandidates ? "NO_CANDIDATES" : "STALLED";
  return { state, reason: state === "STALLED" ? "EXPECTED_CYCLE_ELAPSED_WITHOUT_SUCCESS_OR_ACTIVE_WORK" : state, cadenceMinutes, graceMinutes,
    expectedAt: input.active && input.configured ? expected.toISOString() : null, lastAttemptAt: input.lastAttemptAt?.toISOString() ?? null, lastSuccessAt: input.lastSuccessAt?.toISOString() ?? null, delayMinutes };
}
