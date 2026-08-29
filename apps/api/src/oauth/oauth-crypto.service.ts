import { Injectable } from "@nestjs/common";
import { loadConfig } from "@postbot/config";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export type EncryptedSecret = {
  cipherText: string;
  cipher: "aes-256-gcm";
  keyVersion: number;
};

const base64url = (value: Buffer): string => value.toString("base64url");

@Injectable()
export class OAuthCryptoService {
  private readonly config = loadConfig();
  private readonly key = createHash("sha256").update(this.config.OAUTH_ENCRYPTION_KEY).digest();

  randomToken(bytes = 32): string {
    return base64url(randomBytes(bytes));
  }

  sha256(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  pkceChallenge(verifier: string): string {
    return base64url(createHash("sha256").update(verifier).digest());
  }

  encrypt(plainText: string): EncryptedSecret {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      cipherText: `${base64url(iv)}.${base64url(tag)}.${base64url(encrypted)}`,
      cipher: "aes-256-gcm",
      keyVersion: this.config.OAUTH_ENCRYPTION_KEY_VERSION
    };
  }

  decrypt(secret: EncryptedSecret): string {
    if (secret.cipher !== "aes-256-gcm") {
      throw new Error("Unsupported OAuth token cipher.");
    }
    const [ivRaw, tagRaw, encryptedRaw] = secret.cipherText.split(".");
    if (!ivRaw || !tagRaw || !encryptedRaw) {
      throw new Error("Invalid encrypted OAuth token payload.");
    }
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(ivRaw, "base64url"));
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedRaw, "base64url")),
      decipher.final()
    ]).toString("utf8");
  }
}
