import { Injectable, UnauthorizedException } from "@nestjs/common";
import { loadConfig } from "@postbot/config";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

type TokenPayload = {
  sub: string;
  workspaceId: string;
  sessionId?: string;
  familyId?: string;
  exp: number;
};

const base64url = (input: Buffer | string): string =>
  Buffer.from(input).toString("base64url");

const sign = (payload: TokenPayload, secret: string): string => {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
};

const verify = (token: string, secret: string): TokenPayload => {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new UnauthorizedException("인증이 만료되었습니다. 다시 로그인해 주세요.");
  }

  const expected = createHmac("sha256", secret)
    .update(`${parts[0]}.${parts[1]}`)
    .digest("base64url");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(parts[2]);
  if (
    expectedBuffer.length !== actualBuffer.length ||
    !timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    throw new UnauthorizedException("인증이 만료되었습니다. 다시 로그인해 주세요.");
  }

  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as TokenPayload;
  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new UnauthorizedException("인증이 만료되었습니다. 다시 로그인해 주세요.");
  }
  return payload;
};

@Injectable()
export class TokenService {
  private readonly config = loadConfig();

  createAccessToken(userId: string, workspaceId: string): string {
    return sign(
      {
        sub: userId,
        workspaceId,
        exp: Math.floor(Date.now() / 1000) + 15 * 60
      },
      this.config.JWT_ACCESS_SECRET
    );
  }

  createRefreshToken(userId: string, workspaceId: string, sessionId: string, familyId: string): string {
    return sign(
      {
        sub: userId,
        workspaceId,
        sessionId,
        familyId,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7
      },
      this.config.JWT_REFRESH_SECRET
    );
  }

  verifyAccessToken(token: string): TokenPayload {
    return verify(token, this.config.JWT_ACCESS_SECRET);
  }

  verifyRefreshToken(token: string): TokenPayload & { sessionId: string; familyId: string } {
    const payload = verify(token, this.config.JWT_REFRESH_SECRET);
    if (!payload.sessionId || !payload.familyId) {
      throw new UnauthorizedException("세션을 갱신할 수 없습니다. 다시 로그인해 주세요.");
    }
    return { ...payload, sessionId: payload.sessionId, familyId: payload.familyId };
  }

  randomToken(bytes = 32): string {
    return randomBytes(bytes).toString("base64url");
  }

  hashToken(token: string): string {
    return createHmac("sha256", this.config.JWT_REFRESH_SECRET).update(token).digest("hex");
  }

  hashContext(value: string | undefined): string | null {
    return value
      ? createHmac("sha256", this.config.JWT_REFRESH_SECRET).update(value).digest("hex")
      : null;
  }
}
