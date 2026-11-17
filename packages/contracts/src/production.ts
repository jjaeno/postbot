import { z } from "zod";

const Platform = z.enum(["YOUTUBE", "INSTAGRAM", "TIKTOK"]).nullable();
const Version = z.object({ id: z.string().min(1), version: z.number().int().positive() });
export const ProductionReferenceSchema = z.object({
  contractVersion: z.literal("production-result-v1"), contentItemId: z.string().min(1),
  platform: Platform, scriptVersionId: z.string().min(1).nullable(), sceneVersionId: z.string().min(1).nullable()
}).strict();

// A production result describes artifacts. Scheduling, approvals, publication
// and billing decisions belong to operations and are never inferred from it.
export const ProductionResultSchema = z.object({
  reference: ProductionReferenceSchema,
  state: z.enum(["IN_PROGRESS", "REVIEW_REQUIRED", "RENDERED", "FAILED"]),
  originalTitle: z.string(), planning: z.object({ title: z.string().nullable(), summary: z.string().nullable() }),
  sources: z.array(z.object({ id: z.string(), url: z.string(), title: z.string(), publishedAt: z.string().datetime().nullable(),
    collectedAt: z.string().datetime(), scope: z.enum(["FULL_TEXT", "SUMMARY", "UNKNOWN"]),
    text: z.string().nullable(), fingerprint: z.string().nullable() })),
  claims: z.array(z.json()), evidence: z.json().nullable(),
  script: Version.extend({ hook: z.string(), body: z.string(), callToAction: z.string().nullable(), language: z.string() }).nullable(),
  scene: Version.extend({ scriptVersionId: z.string().nullable(), document: z.json() }).nullable(),
  assets: z.array(z.object({ id: z.string(), sceneVersionId: z.string().nullable(), purpose: z.string(), kind: z.string(),
    licenseStatus: z.string(), usage: z.json().nullable() })),
  video: z.object({ key: z.string(), thumbnailKey: z.string().nullable(), rendererVersion: z.string().nullable(),
    actualDurationSeconds: z.number().positive().nullable() }).nullable(),
  quality: z.object({ technical: z.json().nullable(), policy: z.json().nullable() }),
  usage: z.array(z.object({ id: z.string(), productionJobId: z.string().nullable(), provider: z.string(), model: z.string().nullable(),
    operation: z.string(), quantity: z.string(), unit: z.string(), currency: z.string(), estimatedCost: z.string().nullable(), actualCost: z.string().nullable() })),
  reviewReasons: z.array(z.object({ code: z.string(), message: z.string(), scriptVersionId: z.string().nullable(), sceneVersionId: z.string().nullable() })),
  observedAt: z.string().datetime()
}).strict().superRefine((value, ctx) => {
  if (value.reference.scriptVersionId !== (value.script?.id ?? null) || value.reference.sceneVersionId !== (value.scene?.id ?? null)
      || (value.scene && value.scene.scriptVersionId !== (value.script?.id ?? null))) {
    ctx.addIssue({ code: "custom", message: "PRODUCTION_VERSION_MISMATCH" });
  }
  if (value.assets.some((asset) => asset.sceneVersionId !== null && asset.sceneVersionId !== value.reference.sceneVersionId)) {
    ctx.addIssue({ code: "custom", message: "PRODUCTION_ASSET_VERSION_MISMATCH" });
  }
});
export type ProductionResult = z.infer<typeof ProductionResultSchema>;
export type ProductionReference = z.infer<typeof ProductionReferenceSchema>;
export const ProductionResultsResponseSchema = z.object({ contentItemId: z.string(), results: z.array(ProductionResultSchema) });
