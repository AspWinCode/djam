import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { HttpExceptionLoggingFilter } from "../common/http-exception.filter.js";
import { HttpLoggingInterceptor } from "../common/http-logging.interceptor.js";
import { RolesGuard } from "../common/roles.guard.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { RealtimeGateway } from "../realtime/realtime.gateway.js";
import { AdminController } from "./controllers/admin.controller.js";
import { AuthController } from "./controllers/auth.controller.js";
import { HealthController } from "./controllers/health.controller.js";
import { PublicController } from "./controllers/public.controller.js";
import { TrainerController } from "./controllers/trainer.controller.js";
import { AppService } from "./services/app.service.js";
import { AuditLogService } from "./services/audit-log.service.js";
import { AuthService } from "./services/auth.service.js";
import { ContentRepository } from "./services/content.repository.js";
import { MediaRepository } from "./services/media.repository.js";
import { MediaStorageService } from "./services/media-storage.service.js";
import { ProgressRepository } from "./services/progress.repository.js";
import { SessionRepository } from "./services/session.repository.js";

@Module({
  imports: [
    PrismaModule,
    ThrottlerModule.forRoot({
      errorMessage: "Too many requests. Please wait and try again.",
      throttlers: [
        {
          name: "default",
          ttl: 60_000,
          limit: 600
        }
      ]
    })
  ],
  controllers: [AuthController, HealthController, AdminController, TrainerController, PublicController],
  providers: [
    AppService,
    AuditLogService,
    AuthService,
    ContentRepository,
    MediaRepository,
    MediaStorageService,
    ProgressRepository,
    SessionRepository,
    RealtimeGateway,
    {
      provide: APP_FILTER,
      useClass: HttpExceptionLoggingFilter
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpLoggingInterceptor
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard
    }
  ]
})
export class AppModule {}
