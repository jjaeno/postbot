import { Module } from "@nestjs/common";
import { CHANNELS_REPOSITORY } from "./channels.repository.js";
import { ChannelsController } from "./channels.controller.js";
import { PrismaChannelsRepository } from "./prisma-channels.repository.js";
import { ChannelsService } from "./channels.service.js";

@Module({
  controllers: [ChannelsController],
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
