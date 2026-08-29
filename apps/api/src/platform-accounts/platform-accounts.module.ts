import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { OAuthCryptoService } from "../oauth/oauth-crypto.service.js";
import { PlatformAccountsController } from "./platform-accounts.controller.js";
import { PLATFORM_ACCOUNTS_REPOSITORY } from "./platform-accounts.repository.js";
import { PlatformAccountsService } from "./platform-accounts.service.js";
import { PrismaPlatformAccountsRepository } from "./prisma-platform-accounts.repository.js";
import { PublisherProviderFactory } from "./publisher-provider.factory.js";

@Module({
  imports: [DatabaseModule],
  controllers: [PlatformAccountsController],
  providers: [
    OAuthCryptoService,
    PlatformAccountsService,
    PublisherProviderFactory,
    {
      provide: PLATFORM_ACCOUNTS_REPOSITORY,
      useClass: PrismaPlatformAccountsRepository
    }
  ]
})
export class PlatformAccountsModule {}
