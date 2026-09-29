import { describe, expect, it } from "vitest";
import { S3StorageProvider } from "./index.js";

const enabled = process.env.RUN_STORAGE_INTEGRATION === "1" ? describe : describe.skip;
enabled("S3StorageProvider", () => {
  it("supports the MinIO object lifecycle", async () => {
    const storage = new S3StorageProvider({ endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9000", region: process.env.S3_REGION ?? "us-east-1", bucket: process.env.S3_BUCKET ?? "postbot-local", accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "postbot", secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "postbot-password" });
    const key = `contract/${crypto.randomUUID()}`; const body = new TextEncoder().encode("minio-contract");
    await storage.upload({ key, body, mimeType: "text/plain" });
    await expect(storage.download(key)).resolves.toEqual(body);
    await expect(storage.presignedUrl(key, 60)).resolves.toContain("X-Amz-Signature");
    await storage.delete(key);
  });
});
