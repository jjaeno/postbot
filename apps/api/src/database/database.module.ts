import { Global, Module } from "@nestjs/common";
import { createPrismaClient } from "@postbot/database";
import { PrismaAuthRepository } from "../auth/prisma-auth.repository.js";
import { AUTH_REPOSITORY } from "../auth/auth.repository.js";

@Global()
@Module({
  providers: [
    {
      provide: "PRISMA_CLIENT",
      useFactory: () => createPrismaClient()
    },
    {
      provide: AUTH_REPOSITORY,
      useClass: PrismaAuthRepository
    }
  ],
  exports: ["PRISMA_CLIENT", AUTH_REPOSITORY]
})
export class DatabaseModule {}
