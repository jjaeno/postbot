import { z } from "zod";

export const HealthStatusSchema = z.enum(["ok"]);

export const HealthResponseSchema = z.object({
  status: HealthStatusSchema,
  service: z.string().min(1),
  version: z.string().min(1),
  checkedAt: z.string().datetime()
});

export type HealthStatus = z.infer<typeof HealthStatusSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const createHealthResponse = (service: string, version: string): HealthResponse => ({
  status: "ok",
  service,
  version,
  checkedAt: new Date().toISOString()
});
