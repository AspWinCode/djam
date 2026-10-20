import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import type {
  GameStep,
  GameVersion,
  Jam,
  JamGameAnalytics,
  Participant,
  ParticipantMissionPayload,
  ParticipantProgress,
  ParticipantStepProgress,
  JamAnalytics,
  StepHint,
  TrainerParticipantNote,
  TrainerParticipantTimelineEvent,
  TrainerParticipantView,
  TrainerNotification
} from "@game-game/shared";

@Injectable()
export class ProgressRepository {
  constructor(private readonly prisma: PrismaService) {}

  private static readonly STUCK_TIMEOUT_MS = 3 * 60 * 1000;
  private static readonly OFFLINE_TIMEOUT_MS = 10 * 60 * 1000;

  async isEnabled() {
    if (!process.env.DATABASE_URL) {
      return false;
    }

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  async createParticipantProgress(participantId: string, gameVersionId: string): Promise<ParticipantMissionPayload> {
    const version = await this.prisma.gameVersion.findUnique({
      where: { id: gameVersionId }
    });
    const participant = await this.prisma.participant.findUnique({
      where: { id: participantId }
    });

    if (!version || !participant) {
      throw new NotFoundException("Participant or version not found");
    }

    const snapshot = version.snapshotJson as unknown as {
      steps: Array<GameStep & { hints: StepHint[] }>;
    };
    const steps = snapshot.steps;
    const firstStep = steps[0];

    const progress = await this.prisma.$transaction(async (tx) => {
      await tx.participantProgress.deleteMany({
        where: { participantId, gameVersionId }
      });
      await tx.participantStepProgress.deleteMany({
        where: { participantId, gameVersionId }
      });

      const createdProgress = await tx.participantProgress.create({
        data: {
          participantId,
          gameVersionId,
          currentStepId: firstStep.id,
          completedStepsCount: 0,
          totalStepsCount: steps.length,
          xpTotal: 0,
          isCompleted: false
        }
      });

      for (let index = 0; index < steps.length; index += 1) {
        await tx.participantStepProgress.create({
          data: {
            participantId,
            gameVersionId,
            stepId: steps[index].id,
            status: index === 0 ? "active" : "locked",
            startedAt: index === 0 ? new Date() : null
          }
        });
      }

      await tx.participant.update({
        where: { id: participantId },
        data: {
          status: "active",
          lastSeenAt: new Date()
        }
      });

      return createdProgress;
    });

    const stepProgress = await this.prisma.participantStepProgress.findMany({
      where: {
        participantId,
        gameVersionId
      },
      orderBy: [{ startedAt: "asc" }, { stepId: "asc" }]
    });

    return {
      participant: this.toParticipant(participant),
      progress: this.toParticipantProgress(progress),
      version: this.toGameVersion(version),
      stepProgress: stepProgress.map((item) => this.toParticipantStepProgress(item))
    };
  }

  async getProgress(participantId: string): Promise<ParticipantMissionPayload> {
    const participant = await this.prisma.participant.findUnique({
      where: { id: participantId },
      include: {
        jam: true
      }
    });
    if (!participant) {
      throw new NotFoundException("Participant not found");
    }

    const progress = await this.prisma.participantProgress.findFirst({
      where: { participantId },
      orderBy: { startedAt: "desc" }
    });

    if (!progress) {
      return {
        participant: this.toParticipant(participant),
        jam: this.toJam(participant.jam)
      };
    }

    const version = await this.prisma.gameVersion.findUnique({
      where: { id: progress.gameVersionId }
    });
    const stepProgress = await this.prisma.participantStepProgress.findMany({
      where: {
        participantId,
        gameVersionId: progress.gameVersionId
      },
      orderBy: [{ startedAt: "asc" }, { stepId: "asc" }]
    });

    return {
      participant: this.toParticipant(participant),
      jam: this.toJam(participant.jam),
      progress: this.toParticipantProgress(progress),
      version: version ? this.toGameVersion(version) : undefined,
      stepProgress: stepProgress.map((item) => this.toParticipantStepProgress(item))
    };
  }

  async completeStep(participantId: string, stepId: string): Promise<ParticipantProgress> {
    const progress = await this.prisma.participantProgress.findFirst({
      where: { participantId },
      orderBy: { startedAt: "desc" }
    });
    if (!progress) {
      throw new NotFoundException("Progress not found");
    }

    const version = await this.prisma.gameVersion.findUnique({
      where: { id: progress.gameVersionId }
    });
    if (!version) {
      throw new NotFoundException("Version not found");
    }

    const snapshot = version.snapshotJson as unknown as {
      steps: Array<GameStep & { hints: StepHint[] }>;
    };
    const steps = snapshot.steps;
    const currentIndex = steps.findIndex((step) => step.id === stepId);
    if (currentIndex === -1) {
      throw new NotFoundException("Step not found in version");
    }
    if (progress.currentStepId !== stepId) {
      throw new Error("Only the active step can be completed");
    }

    const currentStep = steps[currentIndex];
    const nextStep = steps[currentIndex + 1];

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.participantStepProgress.updateMany({
        where: {
          participantId,
          gameVersionId: progress.gameVersionId,
          stepId
        },
        data: {
          status: "completed",
          completedAt: new Date(),
          needsHelpFlag: false
        }
      });

      if (nextStep) {
        await tx.participantStepProgress.updateMany({
          where: {
            participantId,
            gameVersionId: progress.gameVersionId,
            stepId: nextStep.id
          },
          data: {
            status: "active",
            startedAt: new Date()
          }
        });
      }

      await tx.participant.update({
        where: { id: participantId },
        data: {
          status: nextStep ? "active" : "completed",
          lastSeenAt: new Date()
        }
      });

      return tx.participantProgress.update({
        where: { id: progress.id },
        data: {
          currentStepId: nextStep?.id ?? stepId,
          completedStepsCount: progress.completedStepsCount + 1,
          xpTotal: progress.xpTotal + currentStep.successXp,
          isCompleted: !nextStep,
          completedAt: nextStep ? null : new Date(),
          reviewedAt: nextStep ? null : progress.reviewedAt
        }
      });
    });

    return this.toParticipantProgress(updated);
  }

  async openNextHint(participantId: string, stepId: string): Promise<StepHint> {
    const progress = await this.prisma.participantProgress.findFirst({
      where: { participantId },
      orderBy: { startedAt: "desc" }
    });
    if (!progress) {
      throw new NotFoundException("Progress not found");
    }

    const stepProgress = await this.prisma.participantStepProgress.findFirst({
      where: {
        participantId,
        gameVersionId: progress.gameVersionId,
        stepId
      }
    });
    if (!stepProgress) {
      throw new NotFoundException("Step progress not found");
    }

    const version = await this.prisma.gameVersion.findUnique({
      where: { id: progress.gameVersionId }
    });
    if (!version) {
      throw new NotFoundException("Version not found");
    }

    const snapshot = version.snapshotJson as unknown as {
      steps: Array<GameStep & { hints: StepHint[] }>;
    };
    const step = snapshot.steps.find((item) => item.id === stepId);
    if (!step) {
      throw new NotFoundException("Step not found");
    }

    const nextLevel = stepProgress.lastHintLevelOpened + 1;

    // Support inline <hint-block> elements embedded in description HTML
    const inlineHints = ProgressRepository.extractInlineHints(step.description ?? "");
    let returnedHint: StepHint;

    if (inlineHints.length > 0) {
      if (nextLevel > inlineHints.length) {
        throw new Error("All hints are already opened");
      }
      // Construct a virtual StepHint from the inline block content
      returnedHint = {
        id: `inline-${step.id}-${nextLevel}`,
        stepId: step.id,
        level: nextLevel,
        text: inlineHints[nextLevel - 1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        hintType: "text",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    } else {
      const hint = step.hints.find((item) => item.level === nextLevel);
      if (!hint) {
        throw new Error("All hints are already opened");
      }
      returnedHint = hint;
    }

    await this.prisma.participantStepProgress.update({
      where: { id: stepProgress.id },
      data: {
        hintsOpenedCount: stepProgress.hintsOpenedCount + 1,
        lastHintLevelOpened: nextLevel
      }
    });

    await this.prisma.participant.update({
      where: { id: participantId },
      data: {
        lastSeenAt: new Date()
      }
    });

    return returnedHint;
  }

  private static extractInlineHints(description: string): string[] {
    if (!description) return [];
    const matches = [...description.matchAll(/<hint-block[^>]*>([\s\S]*?)<\/hint-block>/gi)];
    return matches.map((m) => m[1]);
  }

  /** Validates that a hint can be requested (next level exists) and returns metadata for the WS event. */
  async requestHintOpen(participantId: string, stepId: string) {
    const progress = await this.prisma.participantProgress.findFirst({
      where: { participantId },
      orderBy: { startedAt: "desc" }
    });
    if (!progress) throw new NotFoundException("Progress not found");

    const stepProgress = await this.prisma.participantStepProgress.findFirst({
      where: { participantId, gameVersionId: progress.gameVersionId, stepId }
    });
    if (!stepProgress) throw new NotFoundException("Step progress not found");

    const version = await this.prisma.gameVersion.findUnique({ where: { id: progress.gameVersionId } });
    if (!version) throw new NotFoundException("Version not found");

    const snapshot = version.snapshotJson as unknown as { steps: Array<GameStep & { hints: StepHint[] }> };
    const step = snapshot.steps.find((s) => s.id === stepId);
    if (!step) throw new NotFoundException("Step not found");

    const nextLevel = stepProgress.lastHintLevelOpened + 1;

    const inlineHints = ProgressRepository.extractInlineHints(step.description ?? "");
    const hasMoreHints = inlineHints.length > 0
      ? nextLevel <= inlineHints.length
      : step.hints.find((h: StepHint) => h.level === nextLevel) !== undefined;

    if (!hasMoreHints) {
      throw new Error("No more hints available");
    }

    const participant = await this.prisma.participant.findUnique({ where: { id: participantId } });

    return {
      participantName: participant?.displayName ?? "Участник",
      stepTitle: step.title,
      nextHintLevel: nextLevel
    };
  }

  async requestHelp(participantId: string, stepId: string): Promise<ParticipantStepProgress> {
    const progress = await this.prisma.participantProgress.findFirst({
      where: { participantId },
      orderBy: { startedAt: "desc" }
    });
    if (!progress) {
      throw new NotFoundException("Progress not found");
    }

    if (progress.isCompleted || progress.currentStepId !== stepId) {
      throw new BadRequestException("Помощь можно запросить только на текущем этапе");
    }

    const stepProgress = await this.prisma.participantStepProgress.findFirst({
      where: {
        participantId,
        gameVersionId: progress.gameVersionId,
        stepId
      }
    });
    if (!stepProgress) {
      throw new NotFoundException("Step progress not found");
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.participant.update({
        where: { id: participantId },
        data: {
          status: "needs_help",
          lastSeenAt: new Date()
        }
      });

      return tx.participantStepProgress.update({
        where: { id: stepProgress.id },
        data: {
          needsHelpFlag: true,
          needsHelpAt: stepProgress.needsHelpFlag ? stepProgress.needsHelpAt : new Date(),
          helpResolvedAt: null
        }
      });
    });

    return this.toParticipantStepProgress(updated);
  }

  async requestReview(participantId: string): Promise<ParticipantProgress> {
    const progress = await this.prisma.participantProgress.findFirst({
      where: { participantId }, orderBy: { startedAt: "desc" }
    });
    if (!progress) throw new NotFoundException("Прогресс не найден");
    if (!progress.isCompleted) throw new BadRequestException("Сначала заверши все этапы игры");
    // Conditional update keeps retries and simultaneous clicks idempotent.
    await this.prisma.participantProgress.updateMany({
      where: { id: progress.id, reviewRequestedAt: null, reviewedAt: null },
      data: { reviewRequestedAt: new Date() }
    });
    const updated = await this.prisma.participantProgress.findUniqueOrThrow({ where: { id: progress.id } });
    return this.toParticipantProgress(updated);
  }

  async listTrainerNotifications(organizationId: string): Promise<TrainerNotification[]> {
    const participants = await this.prisma.participant.findMany({
      where: { jam: { organizationId, status: { in: ["active", "completed"] } } },
      include: {
        jam: true,
        progress: { orderBy: { startedAt: "desc" }, include: { gameVersion: true } },
        stepProgress: { where: { needsHelpFlag: true }, orderBy: { needsHelpAt: "desc" } }
      }
    });
    const notifications: TrainerNotification[] = [];
    for (const participant of participants) {
      const progress = participant.progress[0];
      if (!progress) continue;
      const base = {
        participantId: participant.id, participantName: participant.displayName,
        jamId: participant.jamId, jamTitle: participant.jam.title
      };
      const help = participant.stepProgress.find(step => step.gameVersionId === progress.gameVersionId);
      if (help && !progress.isCompleted) {
        const snapshot = progress.gameVersion.snapshotJson as unknown as { steps: GameStep[] };
        notifications.push({ ...base, id: `help:${help.id}`, kind: "help",
          stepTitle: snapshot.steps.find(step => step.id === help.stepId)?.title,
          createdAt: (help.needsHelpAt ?? participant.lastSeenAt).toISOString() });
      }
      for (const attempt of participant.progress) {
        if (attempt.isCompleted && attempt.reviewRequestedAt && !attempt.reviewedAt) {
          notifications.push({ ...base, id: `review:${attempt.id}`, kind: "review", progressId: attempt.id,
            createdAt: attempt.reviewRequestedAt.toISOString() });
        }
      }
    }
    return notifications.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async resolveHelp(participantId: string): Promise<void> {
    const progress = await this.prisma.participantProgress.findFirst({
      where: { participantId },
      orderBy: { startedAt: "desc" }
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.participant.update({
        where: { id: participantId },
        data: {
          status: "active",
          lastSeenAt: new Date()
        }
      });

      if (progress) {
        await tx.participantStepProgress.updateMany({
          where: {
            participantId,
            gameVersionId: progress.gameVersionId,
            needsHelpFlag: true
          },
          data: {
            needsHelpFlag: false,
            helpResolvedAt: new Date()
          }
        });
      }
    });
  }

  async markReviewed(participantId: string, progressId?: string): Promise<ParticipantProgress> {
    // Without an explicit progressId (e.g. a direct "mark reviewed" click rather than a
    // notification deep link), only consider completed attempts — never the participant's
    // newest progress row, which may already be a fresh, unfinished game started after the
    // one actually awaiting review. Prefer whichever completed attempt most recently had a
    // review requested.
    const progress = await this.prisma.participantProgress.findFirst({
      where: { participantId, ...(progressId ? { id: progressId } : { isCompleted: true }) },
      orderBy: progressId ? { startedAt: "desc" } : [{ reviewRequestedAt: "desc" }, { completedAt: "desc" }]
    });
    if (!progress) {
      throw new NotFoundException("Progress not found");
    }
    if (!progress.isCompleted) {
      throw new BadRequestException("Проверить можно только завершённую игру");
    }

    const updated = await this.prisma.participantProgress.update({
      where: { id: progress.id },
      data: {
        reviewedAt: new Date()
      }
    });

    return this.toParticipantProgress(updated);
  }

  async createTrainerParticipantNote(participantId: string, author: { id: string; displayName: string }, body: string): Promise<TrainerParticipantNote> {
    const participant = await this.prisma.participant.findUnique({
      where: { id: participantId }
    });
    if (!participant) {
      throw new NotFoundException("Participant not found");
    }

    const note = await this.prisma.trainerParticipantNote.create({
      data: {
        participantId,
        jamId: participant.jamId,
        authorId: author.id,
        body: body.trim()
      },
      include: {
        author: true
      }
    });

    return this.toTrainerParticipantNote(note);
  }

  async deleteTrainerParticipantNote(noteId: string, authorId: string) {
    const note = await this.prisma.trainerParticipantNote.findUnique({
      where: { id: noteId }
    });
    if (!note) {
      throw new NotFoundException("Note not found");
    }

    if (note.authorId !== authorId) {
      throw new NotFoundException("Note not found");
    }

    await this.prisma.trainerParticipantNote.delete({
      where: { id: noteId }
    });

    return { ok: true };
  }

  async getJamAnalytics(jamId: string): Promise<JamAnalytics> {
    const participants = await this.getTrainerParticipants(jamId);
    const participantIds = participants.map((item) => item.participant.id);

    const progressItems = participantIds.length
      ? await this.prisma.participantProgress.findMany({
          where: {
            participantId: { in: participantIds }
          }
        })
      : [];

    const stepItems = participantIds.length
      ? await this.prisma.participantStepProgress.findMany({
          where: {
            participantId: { in: participantIds }
          }
        })
      : [];

    const versions = progressItems.length
      ? await this.prisma.gameVersion.findMany({
          where: {
            id: { in: [...new Set(progressItems.map((item) => item.gameVersionId))] }
          }
        })
      : [];

    const games: JamGameAnalytics[] = progressItems.map((progress) => {
      const version = versions.find((item) => item.id === progress.gameVersionId);
      const snapshot = version?.snapshotJson as { game?: { title?: string } } | undefined;
      const participant = participants.find((item) => item.participant.id === progress.participantId);
      const participantSteps = stepItems.filter(
        (item) => item.participantId === progress.participantId && item.gameVersionId === progress.gameVersionId
      );

      return {
        gameVersionId: progress.gameVersionId,
        gameTitle: snapshot?.game?.title ?? "Unknown game",
        versionNumber: version?.versionNumber ?? 0,
        participantsCount: 1,
        completedCount: progress.isCompleted ? 1 : 0,
        needsHelpCount: participant?.participant.status === "needs_help" ? 1 : 0,
        averageProgressPercent: Math.round((progress.completedStepsCount / progress.totalStepsCount) * 100),
        hintsOpenedCount: participantSteps.reduce((sum, item) => sum + item.hintsOpenedCount, 0)
      };
    }).reduce<JamGameAnalytics[]>((acc, current) => {
      const existing = acc.find((item) => item.gameVersionId === current.gameVersionId);
      if (!existing) {
        acc.push(current);
        return acc;
      }

      existing.participantsCount += current.participantsCount;
      existing.completedCount += current.completedCount;
      existing.needsHelpCount += current.needsHelpCount;
      existing.hintsOpenedCount += current.hintsOpenedCount;
      existing.averageProgressPercent = Math.round(
        ((existing.averageProgressPercent * (existing.participantsCount - 1)) + current.averageProgressPercent) / existing.participantsCount
      );
      return acc;
    }, []);

    return {
      participantsCount: participants.length,
      activeCount: participants.filter((item) => item.participant.status === "active").length,
      needsHelpCount: participants.filter((item) => item.participant.status === "needs_help").length,
      completedCount: participants.filter((item) => item.participant.status === "completed").length,
      reviewedCount: participants.filter((item) => item.reviewedAt).length,
      stuckCount: participants.filter((item) => item.participant.status === "stuck").length,
      offlineCount: participants.filter((item) => item.participant.status === "offline").length,
      averageProgressPercent:
        participants.length > 0
          ? Math.round(participants.reduce((sum, item) => sum + item.progressPercent, 0) / participants.length)
          : 0,
      helpRequestsCount: stepItems.filter((item) => item.needsHelpAt).length,
      hintsOpenedCount: stepItems.reduce((sum, item) => sum + item.hintsOpenedCount, 0),
      games: games.sort((left, right) => left.versionNumber - right.versionNumber)
    };
  }

  async getParticipantDetail(participantId: string, progressId?: string) {
    const participant = await this.prisma.participant.findUnique({
      where: { id: participantId },
      include: {
        jam: true
      }
    });
    if (!participant) {
      throw new NotFoundException("Participant not found");
    }

    const progress = await this.prisma.participantProgress.findFirst({
      where: { participantId, ...(progressId ? { id: progressId } : {}) },
      orderBy: { startedAt: "desc" }
    });

    if (progressId && !progress) throw new NotFoundException("Результат не найден");

    const stepItems = progress
      ? await this.prisma.participantStepProgress.findMany({
          where: {
            participantId,
            gameVersionId: progress.gameVersionId
          },
          orderBy: { startedAt: "asc" }
        })
      : [];
    const notes = await this.prisma.trainerParticipantNote.findMany({
      where: { participantId },
      include: {
        author: true
      },
      orderBy: { createdAt: "desc" }
    });

    const version = progress
      ? await this.prisma.gameVersion.findUnique({
          where: { id: progress.gameVersionId }
        })
      : null;
    const snapshot = version?.snapshotJson as { steps: GameStep[] } | undefined;
    const versionGameSnapshot = version?.snapshotJson as { game?: { title?: string } } | undefined;
    const stepTitleById = new Map((snapshot?.steps ?? []).map((step) => [step.id, step.title]));
    const participantPayload = {
      ...this.toParticipant(participant),
      status: this.deriveParticipantStatus(participant.status, participant.lastSeenAt)
    };
    const progressPayload = progress ? this.toParticipantProgress(progress) : undefined;
    const stepPayloads = stepItems.map((item) => this.toParticipantStepProgress(item));
    const totalHintsOpened = stepPayloads.reduce((sum, item) => sum + item.hintsOpenedCount, 0);
    const helpRequestsCount = stepPayloads.filter((item) => item.needsHelpAt).length;
    const hardestStep = [...stepPayloads]
      .sort((left, right) => {
        const leftScore = left.hintsOpenedCount + (left.needsHelpAt ? 3 : 0);
        const rightScore = right.hintsOpenedCount + (right.needsHelpAt ? 3 : 0);
        return rightScore - leftScore;
      })
      .find((item) => item.hintsOpenedCount > 0 || item.needsHelpAt);
    const hardestStepTitle = hardestStep ? stepTitleById.get(hardestStep.stepId) : undefined;
    const summaryText = progressPayload
      ? [
          versionGameSnapshot?.game?.title ?? "Mission",
          `${progressPayload.completedStepsCount}/${progressPayload.totalStepsCount} steps`,
          `${progressPayload.xpTotal} XP`,
          `${totalHintsOpened} hints`,
          helpRequestsCount > 0 ? `${helpRequestsCount} help requests` : "no help requests"
        ].join(" | ")
      : undefined;

    return {
      participant: participantPayload,
      jam: {
        id: participant.jam.id,
        title: participant.jam.title,
        joinCode: participant.jam.joinCode,
        joinUrl: participant.jam.joinUrl,
        status: participant.jam.status,
        startedAt: participant.jam.startedAt?.toISOString(),
        endedAt: participant.jam.endedAt?.toISOString(),
        createdBy: participant.jam.createdBy,
        createdAt: participant.jam.createdAt.toISOString()
      },
      progress: progressPayload,
      currentGameTitle: versionGameSnapshot?.game?.title,
      currentVersionLabel: version ? `v${version.versionNumber}` : undefined,
      steps: stepPayloads,
      stepTitles: Object.fromEntries(stepTitleById.entries()),
      timeline: this.buildTimeline(participantPayload, progressPayload, stepPayloads, stepTitleById, versionGameSnapshot?.game?.title),
      notes: notes.map((note) => this.toTrainerParticipantNote(note)),
      resultSummary: progressPayload
        ? {
            completedSteps: progressPayload.completedStepsCount,
            totalSteps: progressPayload.totalStepsCount,
            xpTotal: progressPayload.xpTotal,
            hintsOpenedCount: totalHintsOpened,
            helpRequestsCount,
            hardestStepTitle,
            completedAt: progressPayload.completedAt,
            reviewedAt: progressPayload.reviewedAt,
            summaryText: summaryText ?? ""
          }
        : undefined
    };
  }

  private buildTimeline(
    participant: Participant,
    progress: ParticipantProgress | undefined,
    steps: ParticipantStepProgress[],
    stepTitleById: Map<string, string>,
    currentGameTitle?: string
  ): TrainerParticipantTimelineEvent[] {
    const timeline: TrainerParticipantTimelineEvent[] = [
      {
        id: `joined-${participant.id}`,
        at: participant.joinedAt,
        type: "joined",
        title: "Joined jam",
        description: `${participant.displayName} entered the jam`
      }
    ];

    if (progress) {
      timeline.push({
        id: `selected-game-${progress.id}`,
        at: progress.startedAt,
        type: "selected_jam",
        title: currentGameTitle ? `Selected game: ${currentGameTitle}` : "Selected game",
        description: currentGameTitle ? `Started mission ${currentGameTitle}` : `Started game version ${progress.gameVersionId}`
      });
    }

    for (const step of steps) {
      const stepTitle = stepTitleById.get(step.stepId) ?? step.stepId;

      if (step.startedAt) {
        timeline.push({
          id: `step-started-${step.id}`,
          at: step.startedAt,
          type: "step_started",
          title: `Started step: ${stepTitle}`,
          description: currentGameTitle ? `Working inside ${currentGameTitle}` : undefined
        });
      }

      if (step.hintsOpenedCount > 0) {
        timeline.push({
          id: `hint-opened-${step.id}`,
          at: step.needsHelpAt ?? step.completedAt ?? step.startedAt ?? participant.joinedAt,
          type: "hint_opened",
          title: `Opened hints on step: ${stepTitle}`,
          description: `Hints opened: ${step.hintsOpenedCount}, last level: L${step.lastHintLevelOpened}`
        });
      }

      if (step.needsHelpAt) {
        timeline.push({
          id: `help-requested-${step.id}`,
          at: step.needsHelpAt,
          type: "requested_help",
          title: `Requested help on step: ${stepTitle}`,
          description: currentGameTitle ? `Trainer help requested for ${currentGameTitle}` : undefined
        });
      }

      if (step.helpResolvedAt) {
        timeline.push({
          id: `help-resolved-${step.id}`,
          at: step.helpResolvedAt,
          type: "help_resolved",
          title: `Help resolved on step: ${stepTitle}`,
          description: currentGameTitle ? `Support finished for ${currentGameTitle}` : undefined
        });
      }

      if (step.completedAt) {
        timeline.push({
          id: `step-completed-${step.id}`,
          at: step.completedAt,
          type: "step_completed",
          title: `Completed step: ${stepTitle}`,
          description: currentGameTitle ? `Progress advanced in ${currentGameTitle}` : undefined
        });
      }
    }

    if (progress?.completedAt) {
      timeline.push({
        id: `completed-game-${progress.id}`,
        at: progress.completedAt,
        type: "completed_jam",
        title: currentGameTitle ? `Completed game: ${currentGameTitle}` : "Completed game"
      });
    }

    return timeline.sort((a, b) => +new Date(b.at) - +new Date(a.at));
  }

  async getTrainerParticipants(jamId: string): Promise<TrainerParticipantView[]> {
    const participants = await this.prisma.participant.findMany({
      where: { jamId },
      orderBy: { joinedAt: "asc" }
    });

    const participantIds = participants.map((item) => item.id);
    const progressItems = participantIds.length
      ? await this.prisma.participantProgress.findMany({
          where: {
            participantId: { in: participantIds }
          },
          orderBy: { startedAt: "desc" }
        })
      : [];

    const stepProgressItems = participantIds.length
      ? await this.prisma.participantStepProgress.findMany({
          where: {
            participantId: { in: participantIds }
          }
        })
      : [];

    const versions = progressItems.length
      ? await this.prisma.gameVersion.findMany({
          where: {
            id: { in: [...new Set(progressItems.map((item) => item.gameVersionId))] }
          }
        })
      : [];

    return participants.map((participant) => {
      const progress = progressItems.find((item) => item.participantId === participant.id);
      const version = progress ? versions.find((item) => item.id === progress.gameVersionId) : undefined;
      const snapshot = version?.snapshotJson as { game: { title: string }; steps: GameStep[] } | undefined;
      const step = snapshot?.steps.find((item) => item.id === progress?.currentStepId);
      const participantStepItems = stepProgressItems.filter((item) => item.participantId === participant.id && item.gameVersionId === progress?.gameVersionId);
      const derivedStatus = this.deriveParticipantStatus(participant.status, participant.lastSeenAt);

      return {
        participant: {
          ...this.toParticipant(participant),
          status: derivedStatus
        },
        gameTitle: snapshot?.game?.title,
        currentStepTitle: step?.title,
        progressPercent: progress ? Math.round((progress.completedStepsCount / progress.totalStepsCount) * 100) : 0,
        hintsOpenedCount: participantStepItems.reduce((sum, item) => sum + item.hintsOpenedCount, 0),
        lastActivityAt: participant.lastSeenAt.toISOString(),
        reviewedAt: progress?.reviewedAt?.toISOString(),
        reviewRequestedAt: progress?.reviewRequestedAt?.toISOString()
      };
    });
  }

  private toParticipant(participant: {
    id: string;
    jamId: string;
    displayName: string;
    avatar: string;
    status: "active" | "stuck" | "needs_help" | "completed" | "offline";
    joinedAt: Date;
    lastSeenAt: Date;
  }): Participant {
    return {
      id: participant.id,
      jamId: participant.jamId,
      displayName: participant.displayName,
      avatar: participant.avatar,
      status: participant.status,
      joinedAt: participant.joinedAt.toISOString(),
      lastSeenAt: participant.lastSeenAt.toISOString()
    };
  }

  private deriveParticipantStatus(
    status: "active" | "stuck" | "needs_help" | "completed" | "offline",
    lastSeenAt: Date
  ): Participant["status"] {
    if (status === "needs_help" || status === "completed") {
      return status;
    }

    const idleMs = Date.now() - lastSeenAt.getTime();

    if (idleMs >= ProgressRepository.OFFLINE_TIMEOUT_MS) {
      return "offline";
    }

    if (idleMs >= ProgressRepository.STUCK_TIMEOUT_MS) {
      return "stuck";
    }

    return "active";
  }

  private toParticipantProgress(progress: {
    id: string;
    participantId: string;
    gameVersionId: string;
    currentStepId: string;
    completedStepsCount: number;
    totalStepsCount: number;
    xpTotal: number;
    isCompleted: boolean;
    startedAt: Date;
    completedAt: Date | null;
    reviewedAt: Date | null;
    reviewRequestedAt?: Date | null;
  }): ParticipantProgress {
    return {
      id: progress.id,
      participantId: progress.participantId,
      gameVersionId: progress.gameVersionId,
      currentStepId: progress.currentStepId,
      completedStepsCount: progress.completedStepsCount,
      totalStepsCount: progress.totalStepsCount,
      xpTotal: progress.xpTotal,
      isCompleted: progress.isCompleted,
      startedAt: progress.startedAt.toISOString(),
      completedAt: progress.completedAt?.toISOString(),
      reviewedAt: progress.reviewedAt?.toISOString(),
      reviewRequestedAt: progress.reviewRequestedAt?.toISOString()
    };
  }

  private toJam(jam: {
    id: string;
    organizationId: string;
    title: string;
    joinCode: string;
    joinUrl: string;
    status: "planned" | "active" | "completed" | "cancelled";
    startedAt: Date | null;
    endedAt: Date | null;
    createdBy: string;
    createdAt: Date;
  }): Jam {
    return {
      id: jam.id,
      organizationId: jam.organizationId,
      title: jam.title,
      joinCode: jam.joinCode,
      joinUrl: jam.joinUrl,
      status: jam.status,
      startedAt: jam.startedAt?.toISOString(),
      endedAt: jam.endedAt?.toISOString(),
      createdBy: jam.createdBy,
      createdAt: jam.createdAt.toISOString()
    };
  }

  private toParticipantStepProgress(item: {
    id: string;
    participantId: string;
    gameVersionId: string;
    stepId: string;
    status: "locked" | "active" | "completed";
    startedAt: Date | null;
    completedAt: Date | null;
    hintsOpenedCount: number;
    lastHintLevelOpened: number;
    needsHelpFlag: boolean;
    needsHelpAt: Date | null;
    helpResolvedAt: Date | null;
  }): ParticipantStepProgress {
    return {
      id: item.id,
      participantId: item.participantId,
      gameVersionId: item.gameVersionId,
      stepId: item.stepId,
      status: item.status,
      startedAt: item.startedAt?.toISOString(),
      completedAt: item.completedAt?.toISOString(),
      hintsOpenedCount: item.hintsOpenedCount,
      lastHintLevelOpened: item.lastHintLevelOpened as 0 | 1 | 2 | 3,
      needsHelpFlag: item.needsHelpFlag,
      needsHelpAt: item.needsHelpAt?.toISOString(),
      helpResolvedAt: item.helpResolvedAt?.toISOString()
    };
  }

  private toGameVersion(version: {
    id: string;
    gameId: string;
    versionNumber: number;
    snapshotJson: unknown;
    createdAt: Date;
    createdBy: string;
    isPublishedVersion: boolean;
  }): GameVersion {
    return {
      id: version.id,
      gameId: version.gameId,
      versionNumber: version.versionNumber,
      snapshotJson: version.snapshotJson as GameVersion["snapshotJson"],
      createdAt: version.createdAt.toISOString(),
      createdBy: version.createdBy,
      isPublishedVersion: version.isPublishedVersion
    };
  }

  private toTrainerParticipantNote(note: {
    id: string;
    participantId: string;
    jamId: string;
    authorId: string;
    body: string;
    createdAt: Date;
    author: { displayName: string };
  }): TrainerParticipantNote {
    return {
      id: note.id,
      participantId: note.participantId,
      sessionId: note.jamId,
      authorId: note.authorId,
      authorDisplayName: note.author.displayName,
      body: note.body,
      createdAt: note.createdAt.toISOString()
    };
  }
}
