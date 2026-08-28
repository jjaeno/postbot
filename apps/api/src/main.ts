import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { loadConfig } from "@postbot/config";
import { createLogger } from "@postbot/logger";
import { AppModule } from "./app.module.js";

const bootstrap = async (): Promise<void> => {
  const config = loadConfig();
  const logger = createLogger("postbot-api");
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.enableCors({
    origin: true,
    credentials: true
  });

  await app.listen(config.API_PORT);
  logger.info({ port: config.API_PORT }, "API server started");
};

await bootstrap();
