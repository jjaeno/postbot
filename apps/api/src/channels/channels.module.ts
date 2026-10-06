import { Module } from "@nestjs/common";
import { CHANNELS_REPOSITORY } from "./channels.repository.js";
import { ChannelsController } from "./channels.controller.js";
import { PrismaChannelsRepository } from "./prisma-channels.repository.js";
import { ChannelsService } from "./channels.service.js";
import { StockAssetsController } from "./stock-assets.controller.js";
import { AudioAssetsController } from "./audio-assets.controller.js";

@Module({
  controllers: [ChannelsController, StockAssetsController, AudioAssetsController],
  providers: [
    ChannelsService,
    {
      provide: CHANNELS_REPOSITORY,
      useClass: PrismaChannelsRepository
    }
  ],
  exports: [ChannelsService]
})
export class ChannelsModule {}
