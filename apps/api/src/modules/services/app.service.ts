import { BadRequestException, Injectable } from "@nestjs/common";
import type {
    AcceptInviteDto,
    CreateHintDto,
    CreateIncidentDto,
    CreateInviteDto,
    CreateGameDto,
    CreateOrganizationDto,
    CreateJamDto,
    CreateSupportCaseCommentDto,
    CreateSupportCaseDto,
    CreateTrainerParticipantNoteDto,
    CreateUserDto,
    CreateStepDto,
    JoinSessionDto,
    MediaAsset,
    MediaLibraryPayload,
    RealtimeEvent,
    ReorderStepsDto,
    ResetUserPasswordDto,
    SelectGameDto,
    UploadMediaDto,
    UpdateHintDto,
    UpdateIncidentDto,
    UpdateGameDto,
    UpdateOrganizationDto,
    UpdateSupportCaseDto,
    UpdateStepDto,
    UpdateUserDto
} from "@game-game/shared";
import { nowIso } from "../../common/utils.js";
import { RealtimeGateway } from "../../realtime/realtime.gateway.js";
import { AuditLogService } from "./audit-log.service.js";
import { ContentRepository } from "./content.repository.js";
import { MediaRepository } from "./media.repository.js";
import { ProgressRepository } from "./progress.repository.js";
import { SessionRepository } from "./session.repository.js";
import { AuthService } from "./auth.service.js";

@Injectable()
export class AppService {
  constructor(
    private readonly realtime: RealtimeGateway,
    private readonly auditLog: AuditLogService,
    private readonly authService: AuthService,
    private readonly contentRepository: ContentRepository,
    private readonly mediaRepository: MediaRepository,
    private readonly sessionRepository: SessionRepository,
    private readonly progressRepository: ProgressRepository
  ) {}

  listGamesForOrganization(organizationId: string) {
    return this.contentRepository.listGames(organizationId);
  }

  listGameTemplates(organizationId: string) {
    return this.contentRepository.listTemplates(organizationId);
  }

  createGame(dto: CreateGameDto, organizationId: string, userId: string) {
    return this.contentRepository.createGame(dto, organizationId, userId);
  }

  getGameDetail(id: string, organizationId: string, currentUserId?: string) {
    return this.contentRepository.getGameDetail(id, organizationId, currentUserId);
  }

  updateGame(id: string, dto: UpdateGameDto, organizationId: string, userId: string) {
    return this.contentRepository.updateGame(id, dto, organizationId, userId);
  }

  duplicateGame(id: string, organizationId: string, userId: string) {
    return this.contentRepository.duplicateGame(id, organizationId, userId);
  }

  createGameFromTemplate(templateId: string, organizationId: string, userId: string) {
    return this.contentRepository.createGameFromTemplate(templateId, organizationId, userId);
  }

  archiveGame(id: string, organizationId: string, userId: string) {
    return this.contentRepository.archiveGame(id, organizationId, userId);
  }

  deleteGame(id: string, organizationId: string) {
    return this.contentRepository.deleteGame(id, organizationId);
  }

  async publishGame(id: string, organizationId: string, userId: string) {
    try {
      return await this.contentRepository.publishGame(id, organizationId, userId);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "Publish failed");
    }
  }

  createStep(gameId: string, dto: CreateStepDto) {
    if (!dto.title.trim()) {
      throw new BadRequestException("Step title is required");
    }

    return this.contentRepository.createStep(gameId, dto);
  }

  updateStep(stepId: string, dto: UpdateStepDto) {
    if (dto.title !== undefined && !dto.title.trim()) {
      throw new BadRequestException("Step title is required");
    }

    return this.contentRepository.updateStep(stepId, dto);
  }

  deleteStep(stepId: string) {
    return this.contentRepository.deleteStep(stepId);
  }

  reorderSteps(gameId: string, dto: ReorderStepsDto) {
    return this.contentRepository.reorderSteps(gameId, dto);
  }

  createHint(stepId: string, dto: CreateHintDto) {
    return this.contentRepository.createHint(stepId, dto);
  }

  updateHint(hintId: string, dto: UpdateHintDto) {
    return this.contentRepository.updateHint(hintId, dto);
  }

  deleteHint(hintId: string) {
    return this.contentRepository.deleteHint(hintId);
  }

  listVersions(gameId: string) {
    return this.contentRepository.listVersions(gameId);
  }

  listPublishedVersions(organizationId: string) {
    return this.contentRepository.listPublishedVersions(organizationId);
  }

  getVersion(versionId: string, organizationId: string) {
    return this.contentRepository.getVersion(versionId, organizationId);
  }

  restoreGameFromVersion(versionId: string, organizationId: string, userId: string) {
    return this.contentRepository.restoreGameFromVersion(versionId, organizationId, userId);
  }

  acquireGameEditLock(gameId: string, organizationId: string, user: { id: string; displayName: string }) {
    return this.contentRepository.acquireGameEditLock(gameId, organizationId, user);
  }

  heartbeatGameEditLock(gameId: string, organizationId: string, userId: string) {
    return this.contentRepository.heartbeatGameEditLock(gameId, organizationId, userId);
  }

  releaseGameEditLock(gameId: string, organizationId: string, userId: string) {
    return this.contentRepository.releaseGameEditLock(gameId, organizationId, userId);
  }

  listMediaAssets(organizationId: string) {
    return this.mediaRepository.listRecentAssets(organizationId);
  }

  getMediaLibrary(organizationId: string): Promise<MediaLibraryPayload> {
    return this.mediaRepository.getMediaLibrary(organizationId);
  }

  async deleteOrphanedMediaAsset(assetId: string, organizationId: string) {
    try {
      return await this.mediaRepository.deleteOrphanedAsset(assetId, organizationId);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "Media asset cleanup failed");
    }
  }

  listAuditLogs(limit?: number) {
    return this.auditLog.listRecent(limit);
  }

  getOpsSummary(windowHours?: number) {
    return this.auditLog.getOpsSummary(windowHours);
  }

  getAdminReporting(organizationId: string, windowDays?: number) {
    return this.auditLog.getAdminReporting(organizationId, windowDays);
  }

  listUsers(organizationId?: string) {
    return this.authService.listUsers(organizationId);
  }

  listOrganizations(userId?: string) {
    return this.authService.listOrganizations(userId);
  }

  createOrganization(dto: CreateOrganizationDto, userId?: string) {
    return this.authService.createOrganization(dto, userId);
  }

  updateOrganization(organizationId: string, dto: UpdateOrganizationDto, changedById?: string) {
    return this.authService.updateOrganization(organizationId, dto, changedById);
  }

  listOrganizationPlanEvents(organizationId?: string) {
    return this.authService.listOrganizationPlanEvents(organizationId);
  }

  getCommercialOverview(userId?: string) {
    return this.authService.getCommercialOverview(userId);
  }

  getCommercialHistory(userId?: string, windowDays?: number) {
    return this.authService.getCommercialHistory(userId, windowDays);
  }

  activateOrganization(organizationId: string) {
    return this.authService.setOrganizationActive(organizationId, true);
  }

  deactivateOrganization(organizationId: string) {
    return this.authService.setOrganizationActive(organizationId, false);
  }

  getOrganizationOnboarding(organizationId: string, userId?: string) {
    return this.authService.getOrganizationOnboarding(organizationId, userId);
  }

  listInvites(organizationId?: string) {
    return this.authService.listInvites(organizationId);
  }

  listSupportCases() {
    return this.authService.listSupportCases();
  }

  listSupportCaseComments() {
    return this.authService.listSupportCaseComments();
  }

  createSupportCase(createdById: string, dto: CreateSupportCaseDto) {
    return this.authService.createSupportCase(createdById, dto);
  }

  createSupportCaseComment(supportCaseId: string, authorId: string, dto: CreateSupportCaseCommentDto) {
    return this.authService.createSupportCaseComment(supportCaseId, authorId, dto);
  }

  updateSupportCase(caseId: string, dto: UpdateSupportCaseDto) {
    return this.authService.updateSupportCase(caseId, dto);
  }

  listIncidents() {
    return this.authService.listIncidents();
  }

  getPublicStatus() {
    return this.authService.getPublicStatus();
  }

  createIncident(createdById: string, dto: CreateIncidentDto) {
    return this.authService.createIncident(createdById, dto);
  }

  updateIncident(incidentId: string, dto: UpdateIncidentDto) {
    return this.authService.updateIncident(incidentId, dto);
  }

  createInvite(invitedById: string, dto: CreateInviteDto) {
    return this.authService.createInvite(invitedById, dto);
  }

  getInvitePreview(token: string) {
    return this.authService.getInvitePreview(token);
  }

  createSupportSession(adminUserId: string, targetUserId: string, meta?: { ipAddress?: string; userAgent?: string }) {
    return this.authService.createSupportSession(adminUserId, targetUserId, meta);
  }

  endSupportSession(currentToken: string) {
    return this.authService.endSupportSession(currentToken);
  }

  acceptInvite(dto: AcceptInviteDto) {
    return this.authService.acceptInvite(dto);
  }

  createUser(dto: CreateUserDto) {
    return this.authService.createUser(dto);
  }

  updateUser(userId: string, dto: UpdateUserDto) {
    return this.authService.updateUser(userId, dto);
  }

  activateUser(userId: string) {
    return this.authService.setUserActive(userId, true);
  }

  deactivateUser(userId: string) {
    return this.authService.setUserActive(userId, false);
  }

  resetUserPassword(userId: string, dto: ResetUserPasswordDto) {
    return this.authService.resetUserPassword(userId, dto);
  }

  uploadMedia(dto: UploadMediaDto, organizationId: string): Promise<MediaAsset> {
    return this.mediaRepository.createAsset(dto, organizationId);
  }

  uploadMediaFile(file: { originalname: string; mimetype: string; size: number; buffer: Buffer }, organizationId: string): Promise<MediaAsset> {
    return this.mediaRepository.createAssetFromFile(file, organizationId);
  }

  createJam(dto: CreateJamDto, organizationId: string) {
    return this.sessionRepository.createJam(dto, organizationId);
  }

  listJams(organizationId: string) {
    return this.sessionRepository.listJams(organizationId);
  }

  async getJam(id: string, organizationId: string) {
    const detail = await this.sessionRepository.getJam(id, organizationId);
    detail.participants = await this.progressRepository.getTrainerParticipants(id);
    detail.analytics = await this.progressRepository.getJamAnalytics(id);
    return detail;
  }

  startJam(id: string, organizationId: string) {
    return this.sessionRepository.updateJamStatus(id, organizationId, "active");
  }

  completeJam(id: string, organizationId: string) {
    return this.sessionRepository.updateJamStatus(id, organizationId, "completed");
  }

  cancelJam(id: string, organizationId: string) {
    return this.sessionRepository.updateJamStatus(id, organizationId, "cancelled");
  }

  attachJamGame(jamId: string, dto: { gameVersionId: string; isDefault?: boolean }, organizationId: string) {
    return this.sessionRepository.attachJamGame(jamId, dto, organizationId);
  }

  getJamParticipants(jamId: string) {
    return this.progressRepository.getTrainerParticipants(jamId);
  }

  getJamAnalytics(jamId: string) {
    return this.progressRepository.getJamAnalytics(jamId);
  }

  getParticipant(participantId: string, progressId?: string) {
    return this.progressRepository.getParticipantDetail(participantId, progressId);
  }

  async resolveHelp(participantId: string) {
    const jamId = await this.sessionRepository.getParticipantJam(participantId);
    await this.progressRepository.resolveHelp(participantId);
    this.emitToJam(jamId, {
      type: "trainer_resolved_help",
      payload: { participantId },
      emittedAt: nowIso()
    });

    return { ok: true };
  }

  async markParticipantReviewed(participantId: string, progressId?: string) {
    const jamId = await this.sessionRepository.getParticipantJam(participantId);
    const progress = await this.progressRepository.markReviewed(participantId, progressId);
    this.emitToJam(jamId, {
      type: "participant_status_changed",
      payload: { participantId, progress },
      emittedAt: nowIso()
    });

    return progress;
  }

  createTrainerParticipantNote(participantId: string, dto: CreateTrainerParticipantNoteDto, author: { id: string; displayName: string }) {
    return this.progressRepository.createTrainerParticipantNote(participantId, author, dto.body);
  }

  deleteTrainerParticipantNote(noteId: string, authorId: string) {
    return this.progressRepository.deleteTrainerParticipantNote(noteId, authorId);
  }

  getPublicJam(joinCode: string) {
    return this.sessionRepository.getPublicJam(joinCode);
  }

  async joinPublicJam(joinCode: string, dto: JoinSessionDto) {
    if (!dto.displayName.trim()) {
      throw new BadRequestException("Display name is required");
    }

    const participant = await this.sessionRepository.joinJam(joinCode, dto);
    this.emitToJam(participant.jamId, {
      type: "participant_joined",
      payload: participant,
      emittedAt: nowIso()
    });

    return participant;
  }

  async listParticipantGames(participantId: string) {
    const versionIds = await this.sessionRepository.listParticipantGameVersionIds(participantId);
    const organizationId = await this.sessionRepository.getParticipantOrganizationId(participantId);
    return Promise.all(versionIds.map((versionId) => this.contentRepository.getVersion(versionId, organizationId)));
  }

  selectGame(participantId: string, dto: SelectGameDto) {
    return this.progressRepository.createParticipantProgress(participantId, dto.gameVersionId);
  }

  getProgress(participantId: string) {
    return this.progressRepository.getProgress(participantId);
  }

  async completeStep(stepId: string, participantId: string) {
    const progress = await this.progressRepository.completeStep(participantId, stepId);
    const jamId = await this.sessionRepository.getParticipantJam(participantId);
    this.emitToJam(jamId, {
      type: progress.isCompleted ? "participant_completed_jam" : "participant_progress_updated",
      payload: { participantId, progress },
      emittedAt: nowIso()
    });

    return progress;
  }

  openHint(stepId: string, participantId: string) {
    return this.progressRepository.openNextHint(participantId, stepId);
  }

  async requestHint(stepId: string, participantId: string) {
    const info = await this.progressRepository.requestHintOpen(participantId, stepId);
    const jamId = await this.sessionRepository.getParticipantJam(participantId);
    this.emitToJam(jamId, {
      type: "hint_request_pending",
      payload: { participantId, participantName: info.participantName, stepId, stepTitle: info.stepTitle },
      emittedAt: nowIso()
    });
    return { ok: true };
  }

  async approveHint(participantId: string, stepId: string) {
    const hint = await this.progressRepository.openNextHint(participantId, stepId);
    const jamId = await this.sessionRepository.getParticipantJam(participantId);
    this.emitToJam(jamId, {
      type: "hint_approved",
      payload: { participantId, stepId, hintLevel: hint.level },
      emittedAt: nowIso()
    });
    return hint;
  }

  listTrainerNotifications(organizationId: string) {
    return this.progressRepository.listTrainerNotifications(organizationId);
  }

  async requestReview(participantId: string) {
    const progress = await this.progressRepository.requestReview(participantId);
    const jamId = await this.sessionRepository.getParticipantJam(participantId);
    this.emitToJam(jamId, {
      type: "participant_requested_review", payload: { participantId, progress }, emittedAt: nowIso()
    });
    return progress;
  }

  async needHelp(stepId: string, participantId: string) {
    const request = await this.progressRepository.requestHelp(participantId, stepId);
    const jamId = await this.sessionRepository.getParticipantJam(participantId);
    this.emitToJam(jamId, {
      type: "participant_requested_help",
      payload: { participantId, stepId },
      emittedAt: nowIso()
    });

    return request;
  }

  private emitToJam<T>(jamId: string, event: RealtimeEvent<T>) {
    this.realtime.emit(jamId, event);
  }
}
