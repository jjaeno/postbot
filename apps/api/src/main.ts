import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { assertOperationalConfig, loadConfig } from "@postbot/config";
import { createLogger, runWithLogContext } from "@postbot/logger";
import * as Sentry from "@sentry/node";
import cookieParser from "cookie-parser";
import { json, type NextFunction, type Request, type Response } from "express";
import { AppModule } from "./app.module.js";
import { HttpExceptionResponseFilter } from "./http-exception.filter.js";

const bootstrap = async (): Promise<void> => {
  const config = loadConfig();
  assertOperationalConfig(config);
  if (config.SENTRY_DSN) {
    Sentry.init({ dsn: config.SENTRY_DSN, environment: config.SENTRY_ENVIRONMENT });
  }
  const logger = createLogger("postbot-api");
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.use("/channels/:channelId/stock-assets", json({ limit: "1500kb" }));
  app.use("/channels/:channelId/audio-assets", json({ limit: "1500kb" }));
  // Nest skips its default JSON parser when a route-specific parser is registered.
  // Keep the normal 100kb limit for every other endpoint.
  app.use(json());

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
  app.enableShutdownHooks();
  logger.info({ port: config.API_PORT }, "API server started");
};

await bootstrap();
