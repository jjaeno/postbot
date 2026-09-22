import { Module } from "@nestjs/common";
import { OperationsController } from "./operations.controller.js";
import { OperationsService } from "./operations.service.js";
import { OAuthCryptoService } from "../oauth/oauth-crypto.service.js";
@Module({ controllers: [OperationsController], providers: [OperationsService, OAuthCryptoService], exports: [OperationsService] })
export class OperationsModule {}
