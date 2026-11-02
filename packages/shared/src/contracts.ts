import type {
  Game,
  GameEditLock,
  GameStep,
  GameVersion,
  AuditLog,
  ServiceIncident,
  Organization,
  OrganizationMembership,
  OrganizationPlanEvent,
  SupportCaseComment,
  MediaLibraryAsset,
  MediaLibrarySummary,
  Participant,
  ParticipantProgress,
  PublicOrganizationBranding,
  JamAnalytics,
  ParticipantStepProgress,
  Jam,
  JamGame,
  StepHint,
  TrainerParticipantNote,
  SupportCase,
  UserAccount,
  TrainerParticipantView
} from "./domain.js";

export interface CreateGameDto {
  slug: string;
  isTemplate?: boolean;
  title: string;
  shortDescription: string;
  fullDescription: string;
  themeCode: string;
  level: string;
  estimatedDurationMin: number;
  accentStyle: string;
  accentColor: string;
  coverImageUrl?: string;
  previewVideoUrl?: string;
  finalTitle: string;
  finalDescription: string;
  finalRewardXp: number;
}

export interface UpdateGameDto extends Partial<CreateGameDto> {
  expectedUpdatedAt?: string;
}

export interface CreateStepDto {
  title: string;
  description: string;
  goalText: string;
  taskImageUrl?: string;
  taskVideoUrl?: string;
  successTitle: string;
  successText: string;
  successXp: number;
  resultVideoUrl?: string;
  resultImageUrl?: string;
  isBonus?: boolean;
}

export interface UpdateStepDto extends Partial<CreateStepDto> {
  isActive?: boolean;
  expectedUpdatedAt?: string;
}

export interface CreateHintDto {
  level: number;
  text: string;
  hintType: "text" | "image" | "video";
  mediaUrl?: string;
}

export interface UpdateHintDto extends Partial<CreateHintDto> {}

export interface ReorderStepsDto {
  stepIds: string[];
}

export interface UploadMediaDto {
  type: "image" | "video" | "file";
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface CreateJamDto {
  title: string;
}

export interface CreateUserDto {
  email: string;
  displayName: string;
  role: "admin" | "trainer";
  password: string;
  organizationId?: string;
}

export interface UpdateUserDto {
  displayName?: string;
  role?: "admin" | "trainer";
}

export interface ResetUserPasswordDto {
  password: string;
}

export interface ChangePasswordDto {
  currentPassword: string;
  nextPassword: string;
}

export interface CreateOrganizationDto {
  name: string;
  slug: string;
  planKey?: "starter" | "growth" | "school";
  logoUrl?: string;
  brandMessage?: string;
  brandAccentColor?: string;
  maxStorageBytes?: number;
}

export interface UpdateOrganizationDto {
  name?: string;
  slug?: string;
  planKey?: "starter" | "growth" | "school";
  logoUrl?: string;
  brandMessage?: string;
  brandAccentColor?: string;
  maxStorageBytes?: number;
  maxAdminUsers?: number;
  maxTrainerUsers?: number;
  maxActiveSessions?: number;
  maxPublishedJams?: number;
}

export interface CreateSupportCaseDto {
  organizationId: string;
  title: string;
  body: string;
  severity: "low" | "medium" | "high";
}

export interface UpdateSupportCaseDto {
  status?: "open" | "investigating" | "resolved";
}

export interface CreateSupportCaseCommentDto {
  body: string;
}

export interface CreateIncidentDto {
  organizationId: string;
  title: string;
  message: string;
  impact?: string;
  status: "healthy" | "degraded" | "outage" | "resolved";
}

export interface UpdateIncidentDto {
  status?: "healthy" | "degraded" | "outage" | "resolved";
  message?: string;
  impact?: string;
}

export interface CreateInviteDto {
  organizationId: string;
  email: string;
  role: "admin" | "trainer";
  expiresInDays?: number;
}

export interface AcceptInviteDto {
  token: string;
  displayName: string;
  password: string;
}

export interface InvitePreviewPayload {
  token: string;
  email: string;
  role: "admin" | "trainer";
  expiresAt: string;
  organization: PublicOrganizationBranding;
  isValid: boolean;
}

export interface AttachJamGameDto {
  gameVersionId: string;
  isDefault?: boolean;
}

export interface JoinSessionDto {
  displayName: string;
  avatar: string;
}

export interface SelectGameDto {
  gameVersionId: string;
}

export interface ApiResponse<T> {
  data: T;
}

export interface AdminGameDetail {
  game: Game;
  steps: Array<GameStep & { hints: StepHint[] }>;
  versions: GameVersion[];
  editLock?: GameEditLock;
}

export interface JamDetail {
  jam: Jam;
  jamGames: JamGame[];
  participants: TrainerParticipantView[];
  analytics?: JamAnalytics;
}

export interface PublicJamPayload {
  jam: JamDetail["jam"];
  games: GameVersion[];
  organization: PublicOrganizationBranding;
}

export interface TrainerParticipantDetail {
  participant: Participant;
  jam: Jam;
  progress?: ParticipantProgress;
  currentGameTitle?: string;
  currentVersionLabel?: string;
  steps: ParticipantStepProgress[];
  stepTitles: Record<string, string>;
  timeline: TrainerParticipantTimelineEvent[];
  resultSummary?: TrainerParticipantResultSummary;
  notes: TrainerParticipantNote[];
}

export interface CreateTrainerParticipantNoteDto {
  body: string;
}

export interface ParticipantMissionPayload {
  jam?: Jam;
  participant: Participant;
  progress?: ParticipantProgress;
  version?: GameVersion;
  stepProgress?: ParticipantStepProgress[];
}

export interface TrainerParticipantTimelineEvent {
  id: string;
  at: string;
  type: "joined" | "selected_jam" | "step_started" | "hint_opened" | "requested_help" | "help_resolved" | "step_completed" | "completed_jam";
  title: string;
  description?: string;
}

export interface TrainerParticipantResultSummary {
  completedSteps: number;
  totalSteps: number;
  xpTotal: number;
  hintsOpenedCount: number;
  helpRequestsCount: number;
  hardestStepTitle?: string;
  completedAt?: string;
  reviewedAt?: string;
  summaryText: string;
}

export interface HealthDetailsPayload {
  ok: boolean;
  database: string;
  storage: string;
  env: string;
  uptimeSec: number;
  counts: {
    games: number;
    jams: number;
    participants: number;
    authSessions: number;
    auditLogs: number;
  };
  latestAuditAt?: string;
  timestamp: string;
}

export interface AuditLogListPayload {
  items: AuditLog[];
  total: number;
}

export interface OpsSummaryPayload {
  windowHours: number;
  generatedAt: string;
  auth: {
    activeSessions: number;
    failedLogins24h: number;
  };
  trainer: {
    activeSessions: number;
    pendingHelp: number;
    awaitingReview: number;
    completedNotReviewed: number;
  };
  content: {
    publishedVersions24h: number;
    uploads24h: number;
  };
  publicFlow: {
    joins24h: number;
    helpRequests24h: number;
    completedSteps24h: number;
  };
  alerts: Array<{
    level: "info" | "warning" | "critical";
    code: string;
    message: string;
  }>;
}

export interface AdminReportingPayload {
  windowDays: number;
  generatedAt: string;
  funnel: {
    joinsCount: number;
    missionStartsCount: number;
    completedMissionsCount: number;
    reviewedMissionsCount: number;
    helpRequestsCount: number;
    hintOpensCount: number;
    completionRate: number;
    reviewRate: number;
  };
  engagement: {
    averageHintsPerMission: number;
    averageHelpRequestsPerMission: number;
    averageCompletionPercent: number;
    averageJamParticipants: number;
    activeJamsCount: number;
    completedJamsCount: number;
  };
  games: Array<{
    gameId: string;
    gameTitle: string;
    versionsCount: number;
    participantsCount: number;
    completedCount: number;
    reviewedCount: number;
    completionRate: number;
    averageProgressPercent: number;
    hintsOpenedCount: number;
    helpRequestsCount: number;
    lastPublishedAt?: string;
  }>;
  recentJams: Array<{
    jamId: string;
    title: string;
    status: Jam["status"];
    participantsCount: number;
    completedCount: number;
    averageProgressPercent: number;
    startedAt?: string;
    endedAt?: string;
  }>;
  stepInsights: {
    topHintHeavySteps: Array<{
      gameId: string;
      gameTitle: string;
      stepId: string;
      stepTitle: string;
      stepOrderIndex?: number;
      hintsOpenedCount: number;
      helpRequestsCount: number;
      startedCount: number;
      completedCount: number;
      dropOffCount: number;
      completionRate: number;
    }>;
    topHelpSteps: Array<{
      gameId: string;
      gameTitle: string;
      stepId: string;
      stepTitle: string;
      stepOrderIndex?: number;
      hintsOpenedCount: number;
      helpRequestsCount: number;
      startedCount: number;
      completedCount: number;
      dropOffCount: number;
      completionRate: number;
    }>;
    topDropOffSteps: Array<{
      gameId: string;
      gameTitle: string;
      stepId: string;
      stepTitle: string;
      stepOrderIndex?: number;
      hintsOpenedCount: number;
      helpRequestsCount: number;
      startedCount: number;
      completedCount: number;
      dropOffCount: number;
      completionRate: number;
    }>;
  };
  trainers: Array<{
    actorId: string;
    actorDisplay: string;
    sessionsStartedCount: number;
    helpResolvedCount: number;
    reviewsCompletedCount: number;
    notesCreatedCount: number;
    totalActionsCount: number;
  }>;
  cohorts: Array<{
    weekLabel: string;
    joinsCount: number;
    missionStartsCount: number;
    completedMissionsCount: number;
    reviewedMissionsCount: number;
    completionRate: number;
    reviewRate: number;
  }>;
}

export interface MediaLibraryPayload {
  summary: MediaLibrarySummary;
  assets: MediaLibraryAsset[];
}

export interface AdminGameTemplate {
  gameId: string;
  gameTitle: string;
  shortDescription: string;
  level: string;
  estimatedDurationMin: number;
  status: Game["status"];
  stepsCount: number;
  hintsCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSessionInfo {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt?: string;
  ipAddress?: string;
  userAgent?: string;
  isCurrent: boolean;
}

export interface SwitchOrganizationDto {
  organizationId: string;
}

export interface SessionUserSummary {
  id: string;
  email: string;
  displayName: string;
  role: "child" | "trainer" | "admin";
  currentOrganizationId?: string;
  currentOrganizationName?: string;
  currentOrganizationSlug?: string;
  organizations: OrganizationMembership[];
  supportMode?: {
    impersonatedById: string;
    impersonatedByEmail: string;
    impersonatedByDisplayName: string;
  };
}

export interface SessionMePayload {
  user: SessionUserSummary;
  expiresAt: string;
}

export interface CommercialOverviewPayload {
  generatedAt: string;
  organizations: Organization[];
  planEvents: OrganizationPlanEvent[];
  totals: {
    organizationsCount: number;
    activeOrganizationsCount: number;
    storageBytesUsed: number;
    activeSessionsCount: number;
    publishedJamsCount: number;
  };
  upgradeCandidates: Array<{
    organizationId: string;
      organizationName: string;
      reasons: string[];
  }>;
}

export interface CommercialHistoryPoint {
  label: string;
  organizationsCreated: number;
  invitesAccepted: number;
  jamsCreated: number;
  gamesPublished: number;
  mediaUploads: number;
}

export interface CommercialHistoryPayload {
  generatedAt: string;
  windowDays: number;
  points: CommercialHistoryPoint[];
}

export interface OrganizationOnboardingPayload {
  organization: Organization;
  checklist: Array<{
    id: string;
    title: string;
    description: string;
    completed: boolean;
  }>;
  summary: {
    completedCount: number;
    totalCount: number;
  };
}

export interface SupportCenterPayload {
  cases: SupportCase[];
  commentsByCaseId: Record<string, SupportCaseComment[]>;
  incidents: ServiceIncident[];
}

export interface PublicStatusPayload {
  generatedAt: string;
  status: "healthy" | "degraded" | "outage";
  activeIncidents: Array<
    ServiceIncident & {
      organizationName: string;
      organizationSlug: string;
    }
  >;
  recentResolvedIncidents: Array<
    ServiceIncident & {
      organizationName: string;
      organizationSlug: string;
      organizationLogoUrl?: string;
      organizationBrandAccentColor?: string;
    }
  >;
  organizations: PublicOrganizationBranding[];
}
