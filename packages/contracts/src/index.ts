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

export const AuthUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  displayName: z.string().min(1),
  timezone: z.string().min(1)
});

export const AuthWorkspaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
  role: z.enum(["OWNER", "MEMBER"])
});

export const AuthSessionSchema = z.object({
  user: AuthUserSchema,
  workspace: AuthWorkspaceSchema
});

export const RegisterRequestSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(12).max(128),
  displayName: z.string().min(1).max(120),
  timezone: z.string().min(1).max(64).default("Asia/Seoul")
});

export const LoginRequestSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(128)
});

export const AuthResponseSchema = z.object({
  session: AuthSessionSchema,
  csrfToken: z.string().min(32)
});

export const ErrorResponseSchema = z.object({
  message: z.string().min(1),
  code: z.string().min(1)
});

export type AuthUser = z.infer<typeof AuthUserSchema>;
export type AuthWorkspace = z.infer<typeof AuthWorkspaceSchema>;
export type AuthSession = z.infer<typeof AuthSessionSchema>;
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type AuthResponse = z.infer<typeof AuthResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
