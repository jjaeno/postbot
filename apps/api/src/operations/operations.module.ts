import { Module } from "@nestjs/common";
import { OperationsController } from "./operations.controller.js";
import { OperationsService } from "./operations.service.js";
import { OAuthCryptoService } from "../oauth/oauth-crypto.service.js";
import { BullMqMaintenanceQueueAdapter } from "@postbot/jobs";
import { loadConfig } from "@postbot/config";
import { MAINTENANCE_QUEUE } from "./operations.service.js";
import { ProviderRightsController } from "./provider-rights.controller.js";

@Module({
  controllers: [OperationsController, ProviderRightsController],
  providers: [
    OperationsService,
    OAuthCryptoService,
    { provide: MAINTENANCE_QUEUE, useFactory: () => new BullMqMaintenanceQueueAdapter(loadConfig().REDIS_URL) }
  ],
  exports: [OperationsService]
})
export class OperationsModule {}
