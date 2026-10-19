import { BadRequestException, NotFoundException, Body, Controller, Delete, Get, Param, Post, Req, Query } from "@nestjs/common";
import type { AuthRequest } from "../../common/auth.types.js";
import { Roles } from "../../common/roles.decorator.js";
import { AttachJamGameDtoClass, CreateJamDtoClass, CreateTrainerParticipantNoteDtoClass } from "../dto/trainer.dto.js";
import { AppService } from "../services/app.service.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { AuditLogService } from "../services/audit-log.service.js";

function requireOrganizationId(request: AuthRequest) {
  const organizationId = request.user?.currentOrganizationId;
  if (!organizationId) {
    throw new BadRequestException("Active organization is required");
  }
  return organizationId;
}

@Roles("trainer", "admin")
@Controller("trainer")
export class TrainerController {
  constructor(
    private readonly appService: AppService,
    private readonly auditLog: AuditLogService,
    private readonly prisma: PrismaService
  ) {}

  private async requireParticipantAccess(request: AuthRequest, participantId: string) {
    const participant = await this.prisma.participant.findFirst({
      where: { id: participantId, jam: { organizationId: requireOrganizationId(request) } }
    });
    if (!participant) throw new NotFoundException("Участник не найден");
  }

  @Post("jams")
  async createJam(@Req() request: AuthRequest, @Body() body: CreateJamDtoClass) {
    const jam = await this.appService.createJam(body, requireOrganizationId(request));
    await this.auditLog.log({
      action: "trainer.jam.create",
      ...this.auditLog.actorFromRequest(request),
      targetType: "jam",
      targetId: jam.id,
      metadata: { title: jam.title }
    });
    return { data: jam };
  }

  @Get("jams")
  async listJams(@Req() request: AuthRequest) {
    return { data: await this.appService.listJams(requireOrganizationId(request)) };
  }

  @Get("notifications")
  async notifications(@Req() request: AuthRequest) {
    return { data: await this.appService.listTrainerNotifications(requireOrganizationId(request)) };
  }

  @Get("game-versions")
  async listPublishedGameVersions(@Req() request: AuthRequest) {
    return { data: await this.appService.listPublishedVersions(requireOrganizationId(request)) };
  }

  @Get("jams/:id")
  async getJam(@Req() request: AuthRequest, @Param("id") id: string) {
    return { data: await this.appService.getJam(id, requireOrganizationId(request)) };
  }

  @Post("jams/:id/start")
  async startJam(@Req() request: AuthRequest, @Param("id") id: string) {
    const jam = await this.appService.startJam(id, requireOrganizationId(request));
    await this.auditLog.log({
      action: "trainer.jam.start",
      ...this.auditLog.actorFromRequest(request),
      targetType: "jam",
      targetId: id
    });
    return { data: jam };
  }

  @Post("jams/:id/complete")
  async completeJam(@Req() request: AuthRequest, @Param("id") id: string) {
    const jam = await this.appService.completeJam(id, requireOrganizationId(request));
    await this.auditLog.log({
      action: "trainer.jam.complete",
      ...this.auditLog.actorFromRequest(request),
      targetType: "jam",
      targetId: id
    });
    return { data: jam };
  }

  @Post("jams/:id/cancel")
  async cancelJam(@Req() request: AuthRequest, @Param("id") id: string) {
    const jam = await this.appService.cancelJam(id, requireOrganizationId(request));
    await this.auditLog.log({
      action: "trainer.jam.cancel",
      ...this.auditLog.actorFromRequest(request),
      targetType: "jam",
      targetId: id
    });
    return { data: jam };
  }

  @Post("jams/:id/games")
  async attachGame(@Req() request: AuthRequest, @Param("id") id: string, @Body() body: AttachJamGameDtoClass) {
    const jamGame = await this.appService.attachJamGame(id, body, requireOrganizationId(request));
    await this.auditLog.log({
      action: "trainer.jam.attach_game",
      ...this.auditLog.actorFromRequest(request),
      targetType: "jam_game",
      targetId: jamGame.id,
      metadata: { jamId: id, gameVersionId: body.gameVersionId, isDefault: body.isDefault ?? false }
    });
    return { data: jamGame };
  }

  @Get("jams/:id/participants")
  async participants(@Req() request: AuthRequest, @Param("id") id: string) {
    await this.appService.getJam(id, requireOrganizationId(request));
    return { data: await this.appService.getJamParticipants(id) };
  }

  @Get("jams/:id/analytics")
  async analytics(@Req() request: AuthRequest, @Param("id") id: string) {
    await this.appService.getJam(id, requireOrganizationId(request));
    return { data: await this.appService.getJamAnalytics(id) };
  }

  @Get("participants/:id")
  async participant(@Req() request: AuthRequest, @Param("id") id: string, @Query("progress") progressId?: string) {
    await this.requireParticipantAccess(request, id);
    return { data: await this.appService.getParticipant(id, progressId) };
  }

  @Post("participants/:id/resolve-help")
  async resolveHelp(@Req() request: AuthRequest, @Param("id") id: string) {
    await this.requireParticipantAccess(request, id);
    const result = await this.appService.resolveHelp(id);
    await this.auditLog.log({
      action: "trainer.participant.resolve_help",
      ...this.auditLog.actorFromRequest(request),
      targetType: "participant",
      targetId: id
    });
    return { data: result };
  }

  @Post("participants/:id/mark-reviewed")
  async markReviewed(@Req() request: AuthRequest, @Param("id") id: string, @Query("progress") progressId?: string) {
    await this.requireParticipantAccess(request, id);
    const progress = await this.appService.markParticipantReviewed(id, progressId);
    await this.auditLog.log({
      action: "trainer.participant.mark_reviewed",
      ...this.auditLog.actorFromRequest(request),
      targetType: "participant_progress",
      targetId: progress.id,
      metadata: { participantId: id }
    });
    return { data: progress };
  }

  @Post("participants/:id/notes")
  async createNote(@Req() request: AuthRequest, @Param("id") id: string, @Body() body: CreateTrainerParticipantNoteDtoClass) {
    await this.requireParticipantAccess(request, id);
    const note = await this.appService.createTrainerParticipantNote(id, body, {
      id: request.user!.id,
      displayName: request.user!.displayName
    });
    await this.auditLog.log({
      action: "trainer.participant.create_note",
      ...this.auditLog.actorFromRequest(request),
      targetType: "trainer_participant_note",
      targetId: note.id,
      metadata: { participantId: id }
    });
    return { data: note };
  }

  @Delete("participant-notes/:id")
  async deleteNote(@Req() request: AuthRequest, @Param("id") id: string) {
    const result = await this.appService.deleteTrainerParticipantNote(id, request.user!.id);
    await this.auditLog.log({
      action: "trainer.participant.delete_note",
      ...this.auditLog.actorFromRequest(request),
      targetType: "trainer_participant_note",
      targetId: id
    });
    return { data: result };
  }
}
