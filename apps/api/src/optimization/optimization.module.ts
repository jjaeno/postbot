import { Module } from "@nestjs/common";
import { OperationsModule } from "../operations/operations.module.js";
import { OptimizationController } from "./optimization.controller.js";
import { OptimizationService } from "./optimization.service.js";
@Module({ imports: [OperationsModule], controllers: [OptimizationController], providers: [OptimizationService] })
export class OptimizationModule {}
