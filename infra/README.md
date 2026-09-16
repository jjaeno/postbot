# Postbot Local Infrastructure

The local stack is defined in the repository root `docker-compose.yml`.

- MySQL 8-compatible database: `localhost:3307`
- Redis: `localhost:6379`
- MinIO S3-compatible storage: `localhost:9000`
- MinIO console: `http://localhost:9001`

The credentials are development-only placeholders and are mirrored in `.env.example`.
