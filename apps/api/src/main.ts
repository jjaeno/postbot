import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { loadConfig } from "@postbot/config";
import { createLogger } from "@postbot/logger";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module.js";
import { HttpExceptionResponseFilter } from "./http-exception.filter.js";

const bootstrap = async (): Promise<void> => {
  const config = loadConfig();
  const logger = createLogger("postbot-api");
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.use(cookieParser());
  app.useGlobalFilters(new HttpExceptionResponseFilter());
  app.setGlobalPrefix("");
  app.enableCors({
    origin: true,
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
