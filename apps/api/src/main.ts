import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { loadConfig } from "@postbot/config";
import { createLogger, runWithLogContext } from "@postbot/logger";
import * as Sentry from "@sentry/node";
import cookieParser from "cookie-parser";
import type { NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module.js";
import { HttpExceptionResponseFilter } from "./http-exception.filter.js";

const bootstrap = async (): Promise<void> => {
  const config = loadConfig();
  if (config.SENTRY_DSN) {
    Sentry.init({ dsn: config.SENTRY_DSN, environment: config.SENTRY_ENVIRONMENT });
  }
  const logger = createLogger("postbot-api");
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.use(cookieParser());
  app.use((req: Request, res: Response, next: NextFunction) => {
    const correlationId = typeof req.headers["x-correlation-id"] === "string" ? req.headers["x-correlation-id"].slice(0, 128) : crypto.randomUUID();
    res.setHeader("x-correlation-id", correlationId);
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "strict-origin-when-cross-origin");
    res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
    if (config.APP_ENV === "production") {
      res.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
      res.setHeader("content-security-policy", "default-src 'self'; frame-ancestors 'none'; base-uri 'self'");
    }
    runWithLogContext({ correlationId }, next);
  });
  app.useGlobalFilters(new HttpExceptionResponseFilter());
  app.setGlobalPrefix("");
  app.enableCors({
    origin: config.WEB_BASE_URL,
    credentials: true
  });

  const openApiConfig = new DocumentBuilder()
    .setTitle("Postbot API")
    .setDescription("Postbot REST API")
    .setVersion("0.1.0")
    .build();
  const document = SwaggerModule.createDocument(app, openApiConfig);
  SwaggerModule.setup("openapi", app, document);

  await app.listen(config.API_PORT);
  logger.info({ port: config.API_PORT }, "API server started");
};

await bootstrap();
