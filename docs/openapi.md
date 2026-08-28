# Postbot OpenAPI

The NestJS API exposes the generated OpenAPI UI at:

```text
http://localhost:3000/openapi
```

Current 3단계 endpoints:

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | No | API health check |
| POST | `/auth/register` | No | Create user, default workspace, and secure session cookies |
| POST | `/auth/login` | No | Verify email/password and issue secure session cookies |
| POST | `/auth/refresh` | CSRF cookie/header | Rotate refresh token and issue a new access token |
| POST | `/auth/logout` | CSRF cookie/header | Revoke current refresh token and clear cookies |
| GET | `/auth/me` | Access cookie | Return the current user and default workspace |
| GET | `/auth/workspaces/:workspaceId/access-check` | Access cookie | Guarded workspace access check for later domain APIs |

Authenticated mutating requests must include:

```text
x-csrf-token: <postbot_csrf cookie value>
```

Access and refresh JWTs are stored only in `HttpOnly` cookies. API responses never return token values.
