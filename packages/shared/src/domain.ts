export type Role = "child" | "trainer" | "admin";

export type GameStatus = "draft" | "published" | "archived";
export type JamStatus = "planned" | "active" | "completed" | "cancelled";
export type ParticipantStatus = "active" | "stuck" | "needs_help" | "completed" | "offline";
export type StepProgressStatus = "locked" | "active" | "completed";
export type HintType = "text" | "image" | "video";

export interface Game {
  id: string;
  organizationId: string;
  slug: string;
  isTemplate: boolean;
  title: string;
  shortDescription: string;
  fullDescription: string;
  themeCode: string;
  level: string;
  estimatedDurationMin: number;
  coverImageUrl?: string;
  previewVideoUrl?: string;
  accentStyle: string;
  accentColor: string;
  finalTitle: string;
  finalDescription: string;
  finalRewardXp: number;
  status: GameStatus;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

export interface GameStep {
  id: string;
  gameId: string;
  orderIndex: number;
  title: string;
  description: string;
  goalText: string;
  taskImageUrl?: string;
  taskVideoUrl?: string;
  resultVideoUrl?: string;
  resultImageUrl?: string;
  successTitle: string;
  successText: string;
  successXp: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StepHint {
  id: string;
  stepId: string;
  level: number;
  text: string;
  hintType: HintType;
  mediaUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GameVersion {
  id: string;
  gameId: string;
  versionNumber: number;
  snapshotJson: GameSnapshot;
  createdAt: string;
  createdBy: string;
  isPublishedVersion: boolean;
}

export interface GameEditLock {
  id: string;
  gameId: string;
  organizationId: string;
  userId: string;
  userDisplayName: string;
  acquiredAt: string;
  expiresAt: string;
  isOwnedByCurrentUser?: boolean;
}

export interface GameSnapshot {
  game: Game;
  steps: Array<
    GameStep & {
      hints: StepHint[];
    }
  >;
  finalScreen: {
    title: string;
    description: string;
    rewardXp: number;
  };
}

export interface Jam {
  id: string;
  organizationId: string;
  title: string;
  joinCode: string;
  joinUrl: string;
  status: JamStatus;
  startedAt?: string;
  endedAt?: string;
  createdBy: string;
  createdAt: string;
  archiveSummary?: JamArchiveSummary;
}

export interface JamArchiveSummary {
  participantsCount: number;
  completedCount: number;
  reviewedCount: number;
  averageProgressPercent: number;
  helpRequestsCount: number;
  hintsOpenedCount: number;
}

export interface JamAnalytics {
  participantsCount: number;
  activeCount: number;
  needsHelpCount: number;
  completedCount: number;
  reviewedCount: number;
  stuckCount: number;
  offlineCount: number;
  averageProgressPercent: number;
  helpRequestsCount: number;
  hintsOpenedCount: number;
  games: JamGameAnalytics[];
}

export interface JamGameAnalytics {
  gameVersionId: string;
  gameTitle: string;
  versionNumber: number;
  participantsCount: number;
  completedCount: number;
  needsHelpCount: number;
  averageProgressPercent: number;
  hintsOpenedCount: number;
}

export interface JamGame {
  id: string;
  jamId: string;
  gameVersionId: string;
  isDefault: boolean;
  orderIndex: number;
}

export interface Participant {
  id: string;
  jamId: string;
  displayName: string;
  avatar: string;
  status: ParticipantStatus;
  joinedAt: string;
  lastSeenAt: string;
}

export interface TrainerParticipantNote {
  id: string;
  participantId: string;
  sessionId: string;
  authorId: string;
  authorDisplayName: string;
  body: string;
  createdAt: string;
}

export interface ParticipantProgress {
  id: string;
  participantId: string;
  gameVersionId: string;
  currentStepId: string;
  completedStepsCount: number;
  totalStepsCount: number;
  xpTotal: number;
  isCompleted: boolean;
  startedAt: string;
  completedAt?: string;
  reviewedAt?: string;
  reviewRequestedAt?: string;
}

export interface ParticipantStepProgress {
  id: string;
  participantId: string;
  gameVersionId: string;
  stepId: string;
  status: StepProgressStatus;
  startedAt?: string;
  completedAt?: string;
  hintsOpenedCount: number;
  lastHintLevelOpened: number;
  needsHelpFlag: boolean;
  needsHelpAt?: string;
  helpResolvedAt?: string;
}

export interface MediaAsset {
  id: string;
  organizationId: string;
  type: "image" | "video" | "file";
  url: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: string;
}

export interface MediaAssetUsage {
  scope: "jam_cover" | "jam_preview" | "step_result_image" | "step_result_video" | "hint_media";
  jamId: string;
  jamTitle: string;
  stepId?: string;
  stepTitle?: string;
  hintId?: string;
}

export interface MediaLibraryAsset extends MediaAsset {
  usageCount: number;
  orphaned: boolean;
  usages: MediaAssetUsage[];
}

export interface MediaLibrarySummary {
  totalAssets: number;
  totalBytes: number;
  storageLimitBytes: number;
  usagePercent: number;
  usedAssets: number;
  orphanedAssets: number;
  imageCount: number;
  videoCount: number;
  fileCount: number;
  largestOrphanedBytes: number;
}

export interface AuditLog {
  id: string;
  action: string;
  status: "success" | "failure";
  actorType: "user" | "participant" | "anonymous" | "system";
  actorId?: string;
  actorEmail?: string;
  actorRole?: Role;
  targetType?: string;
  targetId?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface UserAccount {
  id: string;
  email: string;
  displayName: string;
  role: Exclude<Role, "child">;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastSessionAt?: string;
  activeSessionCount: number;
  organizations: OrganizationMembership[];
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  planKey: "starter" | "growth" | "school";
  logoUrl?: string;
  brandMessage?: string;
  brandAccentColor?: string;
  maxStorageBytes: number;
  maxAdminUsers: number;
  maxTrainerUsers: number;
  maxActiveSessions: number;
  maxPublishedJams: number;
  activeAdminUsers: number;
  activeTrainerUsers: number;
  activeSessionsCount: number;
  publishedJamsCount: number;
  storageBytesUsed: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationPlanEvent {
  id: string;
  organizationId: string;
  changedById?: string;
  fromPlanKey?: "starter" | "growth" | "school";
  toPlanKey: "starter" | "growth" | "school";
  reason?: string;
  snapshotJson?: Record<string, unknown>;
  createdAt: string;
}

export interface PublicOrganizationBranding {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string;
  brandMessage?: string;
  brandAccentColor?: string;
}

export interface SupportCase {
  id: string;
  organizationId: string;
  title: string;
  body: string;
  severity: "low" | "medium" | "high";
  status: "open" | "investigating" | "resolved";
  createdBy: string;
  commentsCount: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export interface SupportCaseComment {
  id: string;
  supportCaseId: string;
  organizationId: string;
  authorId: string;
  authorDisplayName: string;
  body: string;
  createdAt: string;
}

export interface ServiceIncident {
  id: string;
  organizationId: string;
  title: string;
  message: string;
  impact?: string;
  status: "healthy" | "degraded" | "outage" | "resolved";
  startedAt: string;
  updatedAt: string;
  resolvedAt?: string;
  createdBy: string;
}

export interface OrganizationMembership {
  id: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: Exclude<Role, "child">;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserInvite {
  id: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  email: string;
  role: Exclude<Role, "child">;
  status: "pending" | "accepted" | "revoked" | "expired";
  token: string;
  expiresAt: string;
  acceptedAt?: string;
  createdAt: string;
  invitedBy: string;
}

export interface TrainerParticipantView {
  participant: Participant;
  gameTitle?: string;
  currentStepTitle?: string;
  progressPercent: number;
  hintsOpenedCount: number;
  lastActivityAt: string;
  reviewedAt?: string;
  reviewRequestedAt?: string;
}

export interface RealtimeEvent<T = unknown> {
  type:
    | "participant_joined"
    | "participant_progress_updated"
    | "participant_status_changed"
    | "participant_requested_review"
    | "participant_requested_help"
    | "participant_completed_jam"
    | "trainer_resolved_help"
    | "session_snapshot"
    | "hint_request_pending"
    | "hint_approved";
  payload: T;
  emittedAt: string;
}

export interface ParticipantProgressRealtimePayload {
  participantId: string;
  progress: ParticipantProgress;
}

export interface ParticipantHelpRealtimePayload {
  participantId: string;
  stepId?: string;
}

export interface SessionSnapshotRealtimePayload {
  jamId: string;
  participantsCount: number;
  generatedAt: string;
}

export interface HintRequestPendingRealtimePayload {
  participantId: string;
  participantName: string;
  stepId: string;
  stepTitle: string;
}

export interface HintApprovedRealtimePayload {
  participantId: string;
  stepId: string;
  hintLevel: number;
}

/** Outstanding work, shared by trainers in the current organization. */
export interface TrainerNotification {
  id: string;
  kind: "help" | "review";
  progressId?: string;
  participantId: string;
  participantName: string;
  jamId: string;
  jamTitle: string;
  stepTitle?: string;
  createdAt: string;
}
