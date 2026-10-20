import type {
  AdminReportingPayload,
  AttachJamGameDto,
  CommercialOverviewPayload,
  CommercialHistoryPayload,
  CreateIncidentDto,
  CreateGameDto,
  CreateInviteDto,
  CreateOrganizationDto,
  CreateSupportCaseCommentDto,
  CreateSupportCaseDto,
  UpdateOrganizationDto,
  CreateJamDto,
  AuditLogListPayload,
  CreateUserDto,
  CreateHintDto,
  CreateStepDto,
  CreateTrainerParticipantNoteDto,
  AdminGameDetail,
  AdminGameTemplate,
  GameEditLock,
  JoinSessionDto,
  GameVersion,
  GameStep,
  MediaAsset,
  MediaLibraryPayload,
  OpsSummaryPayload,
  Organization,
  OrganizationOnboardingPayload,
  OrganizationPlanEvent,
  Participant,
  ParticipantMissionPayload,
  ParticipantProgress,
  PublicJamPayload,
  PublicStatusPayload,
  JamAnalytics,
  ResetUserPasswordDto,
  ReorderStepsDto,
  Jam,
  JamDetail,
  ServiceIncident,
  StepHint,
  SupportCase,
  SupportCaseComment,
  TrainerParticipantDetail,
  TrainerParticipantNote,
  UpdateUserDto,
  UserInvite,
  UserAccount,
  UpdateHintDto,
  UpdateIncidentDto,
  UpdateGameDto,
  UploadMediaDto,
  UpdateSupportCaseDto,
  UpdateStepDto,
  Game
} from "@game-game/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";

async function buildRequestError(response: Response) {
  let message = `Request failed: ${response.status}`;
  let fieldErrors: string[] | undefined;

  try {
    const body = (await response.json()) as { message?: string | string[]; error?: { message?: string | string[] } };
    const json = body.error ?? body;
    if (Array.isArray(json.message)) {
      fieldErrors = json.message;
      message = json.message.join(", ");
    } else if (typeof json.message === "string") {
      message = json.message;
    }
  } catch {
    // Ignore malformed error payloads and keep fallback message.
  }

  if (response.status === 429) {
    // NestJS's ThrottlerGuard emits a per-bucket header (e.g. "Retry-After-join")
    // when a named throttler is used, not always a bare "Retry-After".
    let retryAfterHeader = response.headers.get("Retry-After");
    if (!retryAfterHeader) {
      response.headers.forEach((value, key) => {
        if (!retryAfterHeader && key.toLowerCase().startsWith("retry-after")) {
          retryAfterHeader = value;
        }
      });
    }
    const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : undefined;
    message = retryAfterSec && Number.isFinite(retryAfterSec)
      ? `Слишком много запросов. Попробуйте снова через ${retryAfterSec} сек.`
      : "Слишком много запросов. Подождите немного и повторите попытку.";
    const error = new Error(message);
    Object.assign(error, { status: 429, retryAfterSec });
    return error;
  }

  const error = new Error(message);
  Object.assign(error, { status: response.status, fieldErrors });
  return error;
}

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    cache: "no-store",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) {
    throw await buildRequestError(response);
  }
  const json = (await response.json()) as { data: T };
  return json.data;
}

async function postJson<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    ...init,
    cache: "no-store",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  if (!response.ok) {
    throw await buildRequestError(response);
  }

  const json = (await response.json()) as { data: T };
  return json.data;
}

async function patchJson<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "PATCH",
    ...init,
    cache: "no-store",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  if (!response.ok) {
    throw await buildRequestError(response);
  }

  const json = (await response.json()) as { data: T };
  return json.data;
}

// ─── Admin Games (content) ───────────────────────────────────────────────────

export async function getAdminGameDetail(id: string, cookieHeader?: string): Promise<AdminGameDetail> {
  return await getJson(`/admin/games/${id}`, cookieHeader ? { headers: { cookie: cookieHeader } } : undefined);
}

export async function getAdminGames(cookieHeader?: string) {
  return await getJson<Game[]>(
    `/admin/games`,
    cookieHeader ? { headers: { cookie: cookieHeader } } : undefined
  );
}

export async function getAdminGameTemplates(cookieHeader?: string): Promise<AdminGameTemplate[]> {
  return await getJson(
    `/admin/game-templates`,
    cookieHeader ? { headers: { cookie: cookieHeader } } : undefined
  );
}

export async function createAdminGame(payload: CreateGameDto): Promise<Game> {
  return await postJson(`/admin/games`, payload);
}

export async function duplicateAdminGame(id: string): Promise<Game> {
  return await postJson(`/admin/games/${id}/duplicate`);
}

export async function createAdminGameFromTemplate(templateId: string): Promise<Game> {
  return await postJson(`/admin/game-templates/${templateId}/create-game`);
}

export async function archiveAdminGame(id: string) {
  return await postJson(`/admin/games/${id}/archive`);
}

export async function deleteAdminGame(id: string) {
  const response = await fetch(`${API_URL}/admin/games/${id}`, {
    method: "DELETE",
    cache: "no-store",
    credentials: "include",
    headers: {
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    throw await buildRequestError(response);
  }

  const json = (await response.json()) as { data: { ok?: boolean } };
  return json.data;
}

export async function publishAdminGame(id: string): Promise<GameVersion> {
  return await postJson(`/admin/games/${id}/publish`);
}

export async function restoreAdminGameVersion(versionId: string): Promise<AdminGameDetail> {
  return await postJson(`/admin/game-versions/${versionId}/restore-draft`);
}

export async function acquireAdminGameEditLock(gameId: string): Promise<GameEditLock> {
  return await postJson(`/admin/games/${gameId}/edit-lock/acquire`);
}

export async function heartbeatAdminGameEditLock(gameId: string): Promise<GameEditLock> {
  return await postJson(`/admin/games/${gameId}/edit-lock/heartbeat`);
}

export async function releaseAdminGameEditLock(gameId: string) {
  return await postJson(`/admin/games/${gameId}/edit-lock/release`);
}

export async function updateAdminGame(id: string, payload: UpdateGameDto): Promise<Game> {
  return await patchJson(`/admin/games/${id}`, payload);
}

export async function createAdminStep(gameId: string, payload: CreateStepDto): Promise<GameStep> {
  return await postJson(`/admin/games/${gameId}/steps`, payload);
}

export async function updateAdminStep(stepId: string, payload: UpdateStepDto): Promise<GameStep> {
  return await patchJson(`/admin/steps/${stepId}`, payload);
}

export async function deleteAdminStep(stepId: string) {
  const response = await fetch(`${API_URL}/admin/steps/${stepId}`, {
    method: "DELETE",
    cache: "no-store",
    credentials: "include",
    headers: {
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  const json = (await response.json()) as { data: { ok?: boolean } };
  return json.data;
}

export async function createAdminHint(stepId: string, payload: CreateHintDto): Promise<StepHint> {
  return await postJson(`/admin/steps/${stepId}/hints`, payload);
}

export async function updateAdminHint(hintId: string, payload: UpdateHintDto): Promise<StepHint> {
  return await patchJson(`/admin/hints/${hintId}`, payload);
}

export async function deleteAdminHint(hintId: string) {
  const response = await fetch(`${API_URL}/admin/hints/${hintId}`, {
    method: "DELETE",
    cache: "no-store",
    credentials: "include",
    headers: {
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  const json = (await response.json()) as { data: { ok?: boolean } };
  return json.data;
}

export async function reorderAdminSteps(gameId: string, payload: ReorderStepsDto) {
  return await postJson(`/admin/games/${gameId}/steps/reorder`, payload);
}

export async function uploadAdminMedia(payload: UploadMediaDto): Promise<MediaAsset> {
  return await postJson(`/admin/media/upload`, payload);
}

export async function uploadAdminMediaFile(file: File): Promise<MediaAsset> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_URL}/admin/media/upload-file`, {
    method: "POST",
    cache: "no-store",
    credentials: "include",
    body: formData
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  const json = (await response.json()) as { data: MediaAsset };
  return json.data;
}

export async function getAdminMediaAssets(cookieHeader?: string): Promise<MediaAsset[]> {
  return await getJson(`/admin/media`, cookieHeader ? { headers: { cookie: cookieHeader } } : undefined);
}

export async function getAdminMediaLibrary(cookieHeader?: string): Promise<MediaLibraryPayload> {
  return await getJson(`/admin/media/library`, cookieHeader ? { headers: { cookie: cookieHeader } } : undefined);
}

export async function deleteAdminMediaAsset(assetId: string) {
  const response = await fetch(`${API_URL}/admin/media/${assetId}`, {
    method: "DELETE",
    cache: "no-store",
    credentials: "include",
    headers: {
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    throw await buildRequestError(response);
  }

  const json = (await response.json()) as { data: { ok?: boolean } };
  return json.data;
}

export async function getAdminAuditLogs(limit = 50, cookieHeader?: string): Promise<AuditLogListPayload> {
  return await getJson(
    `/admin/audit-logs?limit=${limit}`,
    cookieHeader ? { headers: { cookie: cookieHeader } } : undefined
  );
}

export async function getAdminUsers(cookieHeader?: string): Promise<UserAccount[]> {
  return await getJson(`/admin/users`, cookieHeader ? { headers: { cookie: cookieHeader } } : undefined);
}

export async function getAdminOrganizations(cookieHeader?: string): Promise<Organization[]> {
  return await getJson(`/admin/organizations`, cookieHeader ? { headers: { cookie: cookieHeader } } : undefined);
}

export async function getAdminOrganizationPlanEvents(cookieHeader?: string): Promise<OrganizationPlanEvent[]> {
  return await getJson(`/admin/organization-plan-events`, cookieHeader ? { headers: { cookie: cookieHeader } } : undefined);
}

export async function getAdminCommercialOverview(cookieHeader?: string): Promise<CommercialOverviewPayload> {
  return await getJson(`/admin/commercial-overview`, cookieHeader ? { headers: { cookie: cookieHeader } } : undefined);
}

export async function getAdminCommercialHistory(windowDays = 30, cookieHeader?: string): Promise<CommercialHistoryPayload> {
  return await getJson(`/admin/commercial-history?windowDays=${windowDays}`, cookieHeader ? { headers: { cookie: cookieHeader } } : undefined);
}

export async function createAdminOrganization(payload: CreateOrganizationDto): Promise<Organization> {
  return await postJson(`/admin/organizations`, payload);
}

export async function updateAdminOrganization(organizationId: string, payload: UpdateOrganizationDto): Promise<Organization> {
  return await patchJson(`/admin/organizations/${organizationId}`, payload);
}

export async function getAdminOrganizationOnboarding(organizationId: string, cookieHeader?: string): Promise<OrganizationOnboardingPayload> {
  return await getJson(`/admin/organizations/${organizationId}/onboarding`, cookieHeader ? { headers: { cookie: cookieHeader } } : undefined);
}

export async function activateAdminOrganization(organizationId: string): Promise<Organization> {
  return await postJson(`/admin/organizations/${organizationId}/activate`);
}

export async function deactivateAdminOrganization(organizationId: string): Promise<Organization> {
  return await postJson(`/admin/organizations/${organizationId}/deactivate`);
}

export async function getAdminInvites(cookieHeader?: string): Promise<UserInvite[]> {
  return await getJson(`/admin/invites`, cookieHeader ? { headers: { cookie: cookieHeader } } : undefined);
}

export async function getAdminSupportCases(cookieHeader?: string): Promise<SupportCase[]> {
  return await getJson(`/admin/support-cases`, cookieHeader ? { headers: { cookie: cookieHeader } } : undefined);
}

export async function getAdminSupportCaseComments(cookieHeader?: string): Promise<Record<string, SupportCaseComment[]>> {
  return await getJson(`/admin/support-case-comments`, cookieHeader ? { headers: { cookie: cookieHeader } } : undefined);
}

export async function createAdminSupportCase(payload: CreateSupportCaseDto): Promise<SupportCase> {
  return await postJson(`/admin/support-cases`, payload);
}

export async function createAdminSupportCaseComment(caseId: string, payload: CreateSupportCaseCommentDto): Promise<SupportCaseComment> {
  return await postJson(`/admin/support-cases/${caseId}/comments`, payload);
}

export async function updateAdminSupportCase(caseId: string, payload: UpdateSupportCaseDto): Promise<SupportCase> {
  return await patchJson(`/admin/support-cases/${caseId}`, payload);
}

export async function getAdminIncidents(cookieHeader?: string): Promise<ServiceIncident[]> {
  return await getJson(`/admin/incidents`, cookieHeader ? { headers: { cookie: cookieHeader } } : undefined);
}

export async function createAdminIncident(payload: CreateIncidentDto): Promise<ServiceIncident> {
  return await postJson(`/admin/incidents`, payload);
}

export async function updateAdminIncident(incidentId: string, payload: UpdateIncidentDto): Promise<ServiceIncident> {
  return await patchJson(`/admin/incidents/${incidentId}`, payload);
}

export async function createAdminInvite(payload: CreateInviteDto): Promise<UserInvite> {
  return await postJson(`/admin/invites`, payload);
}

export async function createAdminUser(payload: CreateUserDto): Promise<UserAccount> {
  return await postJson(`/admin/users`, payload);
}

export async function updateAdminUser(userId: string, payload: UpdateUserDto): Promise<UserAccount> {
  return await patchJson(`/admin/users/${userId}`, payload);
}

export async function activateAdminUser(userId: string): Promise<UserAccount> {
  return await postJson(`/admin/users/${userId}/activate`);
}

export async function deactivateAdminUser(userId: string): Promise<UserAccount> {
  return await postJson(`/admin/users/${userId}/deactivate`);
}

export async function resetAdminUserPassword(userId: string, password: string): Promise<UserAccount> {
  const payload: ResetUserPasswordDto = { password };
  return await postJson(`/admin/users/${userId}/reset-password`, payload);
}

export async function getAdminOpsSummary(cookieHeader?: string): Promise<OpsSummaryPayload> {
  return await getJson(`/admin/ops-summary`, cookieHeader ? { headers: { cookie: cookieHeader } } : undefined);
}

export async function getAdminReporting(windowDays = 30, cookieHeader?: string): Promise<AdminReportingPayload> {
  return await getJson(
    `/admin/reporting?windowDays=${windowDays}`,
    cookieHeader ? { headers: { cookie: cookieHeader } } : undefined
  );
}

// ─── Public / Join ───────────────────────────────────────────────────────────

export async function getPublicJam(joinCode: string): Promise<PublicJamPayload> {
  return await getJson(`/public/jams/${joinCode}`);
}

export async function getParticipantProgress(participantId: string): Promise<ParticipantMissionPayload> {
  return await getJson(`/public/progress/${participantId}`, {
    headers: {
      "x-participant-id": participantId
    }
  });
}

export async function getPublicStatus(): Promise<PublicStatusPayload> {
  return await getJson(`/public/status`);
}

export async function joinJam(joinCode: string, payload: JoinSessionDto): Promise<Participant> {
  return await postJson(`/public/jams/${joinCode}/join`, payload);
}

export async function listParticipantGames(participantId: string): Promise<GameVersion[]> {
  return await getJson(`/public/participants/${participantId}/games`, {
    headers: {
      "x-participant-id": participantId
    }
  });
}

export async function selectParticipantGame(participantId: string, gameVersionId: string) {
  return await postJson(`/public/participants/${participantId}/select-game`, { gameVersionId }, {
    headers: {
      "x-participant-id": participantId
    }
  });
}

export async function completeParticipantStep(stepId: string, participantId: string): Promise<ParticipantProgress> {
  return await postJson(`/public/steps/${stepId}/complete`, undefined, {
    headers: {
      "x-participant-id": participantId
    }
  });
}

export async function openParticipantHint(stepId: string, participantId: string): Promise<StepHint> {
  return await postJson(`/public/steps/${stepId}/open-hint`, undefined, {
    headers: {
      "x-participant-id": participantId
    }
  });
}

export async function requestParticipantHelp(stepId: string, participantId: string) {
  return await postJson(`/public/steps/${stepId}/need-help`, undefined, {
    headers: {
      "x-participant-id": participantId
    }
  });
}

export async function requestParticipantHintOpen(stepId: string, participantId: string): Promise<{ ok: boolean }> {
  return await postJson(`/public/steps/${stepId}/request-hint`, undefined, {
    headers: {
      "x-participant-id": participantId
    }
  });
}

export async function approveParticipantHint(participantId: string, stepId: string): Promise<StepHint> {
  return await postJson(`/admin/participants/${participantId}/approve-hint`, { stepId });
}

// ─── Trainer Jams (events) ───────────────────────────────────────────────────

export async function getTrainerJam(id: string, cookieHeader?: string): Promise<JamDetail> {
  return await getJson(`/trainer/jams/${id}`, cookieHeader ? { headers: { cookie: cookieHeader } } : undefined);
}

export async function getTrainerJams(cookieHeader?: string): Promise<Jam[]> {
  return await getJson<Jam[]>(`/trainer/jams`, cookieHeader ? { headers: { cookie: cookieHeader } } : undefined);
}

export async function getTrainerPublishedGameVersions(cookieHeader?: string): Promise<GameVersion[]> {
  return await getJson<GameVersion[]>(`/trainer/game-versions`, cookieHeader ? { headers: { cookie: cookieHeader } } : undefined);
}

export async function createTrainerJam(payload: CreateJamDto): Promise<Jam> {
  return await postJson(`/trainer/jams`, payload);
}

export async function startTrainerJam(id: string): Promise<Jam> {
  return await postJson(`/trainer/jams/${id}/start`);
}

export async function completeTrainerJam(id: string): Promise<Jam> {
  return await postJson(`/trainer/jams/${id}/complete`);
}

export async function cancelTrainerJam(id: string): Promise<Jam> {
  return await postJson(`/trainer/jams/${id}/cancel`);
}

export async function attachTrainerJamGame(jamId: string, payload: AttachJamGameDto) {
  return await postJson(`/trainer/jams/${jamId}/games`, payload);
}

export async function getTrainerParticipantDetail(id: string, progressId?: string): Promise<TrainerParticipantDetail> {
  return await getJson(`/trainer/participants/${id}${progressId ? `?progress=${encodeURIComponent(progressId)}` : ""}`);
}

export async function getTrainerJamAnalytics(id: string): Promise<JamAnalytics> {
  return await getJson(`/trainer/jams/${id}/analytics`);
}

export async function resolveParticipantHelp(participantId: string) {
  return await postJson(`/trainer/participants/${participantId}/resolve-help`);
}

export async function markTrainerParticipantReviewed(participantId: string, progressId?: string): Promise<ParticipantProgress> {
  return await postJson(`/trainer/participants/${participantId}/mark-reviewed${progressId ? `?progress=${encodeURIComponent(progressId)}` : ""}`);
}

export async function createTrainerParticipantNote(participantId: string, payload: CreateTrainerParticipantNoteDto): Promise<TrainerParticipantNote> {
  return await postJson(`/trainer/participants/${participantId}/notes`, payload);
}

export async function deleteTrainerParticipantNote(noteId: string) {
  const response = await fetch(`${API_URL}/trainer/participant-notes/${noteId}`, {
    method: "DELETE",
    cache: "no-store",
    credentials: "include",
    headers: {
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    throw await buildRequestError(response);
  }

  const json = (await response.json()) as { data: { ok?: boolean } };
  return json.data;
}

export async function getTrainerNotifications(): Promise<import("@game-game/shared").TrainerNotification[]> {
  return getJson("/trainer/notifications");
}

export async function requestParticipantReview(participantId: string): Promise<ParticipantProgress> {
  return postJson(`/public/participants/${participantId}/request-review`, undefined, {
    headers: {
      "x-participant-id": participantId
    }
  });
}
