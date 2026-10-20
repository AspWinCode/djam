import { Body, Controller, Get, Headers, Param, Post, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ParticipantScoped } from "../../common/participant-scoped.decorator.js";
import type { AuthRequest } from "../../common/auth.types.js";
import { JoinJamDtoClass, SelectGameDtoClass } from "../dto/public.dto.js";
import { AuditLogService } from "../services/audit-log.service.js";
import { AppService } from "../services/app.service.js";

@Controller("public")
export class PublicController {
  constructor(
    private readonly appService: AppService,
    private readonly auditLog: AuditLogService
  ) {}

  @Get("jams/:joinCode")
  async getJam(@Param("joinCode") joinCode: string) {
    return { data: await this.appService.getPublicJam(joinCode) };
  }

  @Get("status")
  async getStatus() {
    return { data: await this.appService.getPublicStatus() };
  }

  @Post("jams/:joinCode/join")
  @Throttle({ default: { limit: 60, ttl: 60_000, blockDuration: 60_000 } })
  async join(@Req() request: AuthRequest, @Param("joinCode") joinCode: string, @Body() body: JoinJamDtoClass) {
    const participant = await this.appService.joinPublicJam(joinCode, body);
    await this.auditLog.log({
      action: "public.jam.join",
      ...this.auditLog.participantActor(participant.id, request),
      targetType: "jam",
      targetId: participant.jamId,
      metadata: { joinCode, displayName: participant.displayName }
    });
    return { data: participant };
  }

  @Get("participants/:participantId/games")
  @ParticipantScoped()
  async listParticipantGames(@Param("participantId") participantId: string) {
    return { data: await this.appService.listParticipantGames(participantId) };
  }

  @Post("participants/:participantId/select-game")
  @Throttle({ default: { limit: 120, ttl: 60_000, blockDuration: 30_000 } })
  @ParticipantScoped()
  async selectGame(@Req() request: AuthRequest, @Param("participantId") participantId: string, @Body() body: SelectGameDtoClass) {
    const payload = await this.appService.selectGame(participantId, body);
    await this.auditLog.log({
      action: "public.participant.select_game",
      ...this.auditLog.participantActor(participantId, request),
      targetType: "game_version",
      targetId: body.gameVersionId
    });
    return { data: payload };
  }

  @Post("participants/:participantId/request-review")
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  @ParticipantScoped()
  async requestReview(@Param("participantId") participantId: string) {
    return { data: await this.appService.requestReview(participantId) };
  }

  @Get("progress/:participantId")
  @ParticipantScoped()
  async getProgress(@Param("participantId") participantId: string) {
    return { data: await this.appService.getProgress(participantId) };
  }

  @Post("steps/:stepId/complete")
  @Throttle({ default: { limit: 120, ttl: 60_000, blockDuration: 30_000 } })
  @ParticipantScoped()
  async completeStep(
    @Req() request: AuthRequest,
    @Param("stepId") stepId: string,
    @Headers("x-participant-id") participantId: string
  ) {
    const progress = await this.appService.completeStep(stepId, participantId);
    await this.auditLog.log({
      action: "public.step.complete",
      ...this.auditLog.participantActor(participantId, request),
      targetType: "step",
      targetId: stepId,
      metadata: { progressId: progress.id, isCompleted: progress.isCompleted }
    });
    return { data: progress };
  }

  @Post("steps/:stepId/open-hint")
  @Throttle({ default: { limit: 120, ttl: 60_000, blockDuration: 30_000 } })
  @ParticipantScoped()
  async openHint(@Req() request: AuthRequest, @Param("stepId") stepId: string, @Headers("x-participant-id") participantId: string) {
    const hint = await this.appService.openHint(stepId, participantId);
    await this.auditLog.log({
      action: "public.step.open_hint",
      ...this.auditLog.participantActor(participantId, request),
      targetType: "step",
      targetId: stepId,
      metadata: { level: hint.level }
    });
    return { data: hint };
  }

  @Post("steps/:stepId/request-hint")
  @Throttle({ default: { limit: 120, ttl: 60_000, blockDuration: 30_000 } })
  @ParticipantScoped()
  async requestHint(@Req() request: AuthRequest, @Param("stepId") stepId: string, @Headers("x-participant-id") participantId: string) {
    const result = await this.appService.requestHint(stepId, participantId);
    await this.auditLog.log({
      action: "public.step.request_hint",
      ...this.auditLog.participantActor(participantId, request),
      targetType: "step",
      targetId: stepId
    });
    return { data: result };
  }

  @Post("steps/:stepId/need-help")
  @Throttle({ default: { limit: 120, ttl: 60_000, blockDuration: 30_000 } })
  @ParticipantScoped()
  async needHelp(@Req() request: AuthRequest, @Param("stepId") stepId: string, @Headers("x-participant-id") participantId: string) {
    const stepProgress = await this.appService.needHelp(stepId, participantId);
    await this.auditLog.log({
      action: "public.step.need_help",
      ...this.auditLog.participantActor(participantId, request),
      targetType: "step",
      targetId: stepId,
      metadata: { stepProgressId: stepProgress.id }
    });
    return { data: stepProgress };
  }
}
