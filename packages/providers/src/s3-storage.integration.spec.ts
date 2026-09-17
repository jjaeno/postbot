import { describe, expect, it } from "vitest";
import { S3StorageProvider } from "./index.js";

const enabled = process.env.RUN_STORAGE_INTEGRATION === "1" ? describe : describe.skip;
enabled("S3StorageProvider", () => {
  it("supports the MinIO object lifecycle", async () => {
    const storage = new S3StorageProvider({ endpoint: "http://localhost:9000", region: "us-east-1", bucket: "postbot-local", accessKeyId: "postbot", secretAccessKey: "postbot-password" });
    const key = `contract/${crypto.randomUUID()}`; const body = new TextEncoder().encode("minio-contract");
    await storage.upload({ key, body, mimeType: "text/plain" });
    await expect(storage.download(key)).resolves.toEqual(body);
    await expect(storage.presignedUrl(key, 60)).resolves.toContain("X-Amz-Signature");
    await storage.delete(key);
  });
});
