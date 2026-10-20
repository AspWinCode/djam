import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  Jam,
  JamGame,
  Game,
  GameSnapshot,
  GameStep,
  GameVersion,
  MediaAsset,
  Participant,
  ParticipantProgress,
  ParticipantStepProgress,
  StepHint,
  TrainerParticipantView
} from "@game-game/shared";
import { createId, createJoinCode, nowIso } from "../common/utils.js";

@Injectable()
export class AppStore {
  games = new Map<string, Game>();
  steps = new Map<string, GameStep>();
  hints = new Map<string, StepHint>();
  versions = new Map<string, GameVersion>();
  jams = new Map<string, Jam>();
  jamGames = new Map<string, JamGame>();
  participants = new Map<string, Participant>();
  progress = new Map<string, ParticipantProgress>();
  stepProgress = new Map<string, ParticipantStepProgress>();
  media = new Map<string, MediaAsset>();

  createGame(input: Omit<Game, "id" | "createdAt" | "updatedAt" | "status">): Game {
    const timestamp = nowIso();
    const game: Game = {
      ...input,
      id: createId("game"),
      status: "draft",
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.games.set(game.id, game);
    return game;
  }

  updateGame(id: string, patch: Partial<Game>): Game {
    const game = this.requireGame(id);
    const next = { ...game, ...patch, updatedAt: nowIso() };
    this.games.set(id, next);
    return next;
  }

  requireGame(id: string): Game {
    const game = this.games.get(id);
    if (!game) {
      throw new NotFoundException(`Game ${id} not found`);
    }
    return game;
  }

  requireVersion(id: string): GameVersion {
    const version = this.versions.get(id);
    if (!version) {
      throw new NotFoundException(`Version ${id} not found`);
    }
    return version;
  }

  getGameSteps(gameId: string) {
    return [...this.steps.values()]
      .filter((step) => step.gameId === gameId)
      .sort((a, b) => a.orderIndex - b.orderIndex);
  }

  getStepHints(stepId: string) {
    return [...this.hints.values()]
      .filter((hint) => hint.stepId === stepId)
      .sort((a, b) => a.level - b.level);
  }

  createStep(gameId: string, input: Omit<GameStep, "id" | "gameId" | "orderIndex" | "createdAt" | "updatedAt" | "isActive">): GameStep {
    const orderIndex = this.getGameSteps(gameId).length + 1;
    const timestamp = nowIso();
    const step: GameStep = {
      ...input,
      id: createId("step"),
      gameId,
      orderIndex,
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.steps.set(step.id, step);
    return step;
  }

  updateStep(id: string, patch: Partial<GameStep>): GameStep {
    const step = this.steps.get(id);
    if (!step) {
      throw new NotFoundException(`Step ${id} not found`);
    }
    const next = { ...step, ...patch, updatedAt: nowIso() };
    this.steps.set(id, next);
    return next;
  }

  deleteStep(id: string) {
    this.steps.delete(id);
    [...this.hints.values()]
      .filter((hint) => hint.stepId === id)
      .forEach((hint) => this.hints.delete(hint.id));
  }

  reorderSteps(gameId: string, stepIds: string[]) {
    stepIds.forEach((stepId, index) => {
      const step = this.steps.get(stepId);
      if (step && step.gameId === gameId) {
        this.steps.set(stepId, { ...step, orderIndex: index + 1, updatedAt: nowIso() });
      }
    });
  }

  createHint(stepId: string, input: Omit<StepHint, "id" | "stepId" | "createdAt" | "updatedAt">): StepHint {
    const timestamp = nowIso();
    const hint: StepHint = {
      ...input,
      id: createId("hint"),
      stepId,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.hints.set(hint.id, hint);
    return hint;
  }

  updateHint(id: string, patch: Partial<StepHint>) {
    const hint = this.hints.get(id);
    if (!hint) {
      throw new NotFoundException(`Hint ${id} not found`);
    }
    const next = { ...hint, ...patch, updatedAt: nowIso() };
    this.hints.set(id, next);
    return next;
  }

  createVersion(gameId: string, createdBy: string): GameVersion {
    const game = this.requireGame(gameId);
    const steps = this.getGameSteps(gameId);

    if (steps.length === 0) {
      throw new Error("Cannot publish a game without steps");
    }

    if (steps.some((step) => !step.title.trim())) {
      throw new Error("Cannot publish a game with untitled steps");
    }

    const versionNumber =
      Math.max(
        0,
        ...[...this.versions.values()].filter((version) => version.gameId === gameId).map((version) => version.versionNumber)
      ) + 1;

    const snapshot: GameSnapshot = {
      game: { ...game, status: "published", publishedAt: nowIso() },
      steps: steps.map((step) => ({ ...step, hints: this.getStepHints(step.id) })),
      finalScreen: {
        title: game.finalTitle,
        description: game.finalDescription,
        rewardXp: game.finalRewardXp
      }
    };

    const version: GameVersion = {
      id: createId("ver"),
      gameId,
      versionNumber,
      snapshotJson: snapshot,
      createdAt: nowIso(),
      createdBy,
      isPublishedVersion: true
    };

    this.versions.set(version.id, version);
    this.games.set(gameId, {
      ...game,
      status: "published",
      publishedAt: version.createdAt,
      updatedAt: version.createdAt
    });
    return version;
  }

  createDraftFromPublished(gameId: string, updatedBy: string) {
    const game = this.requireGame(gameId);
    if (game.status !== "published") {
      return game;
    }

    return this.updateGame(gameId, {
      status: "draft",
      updatedBy
    });
  }

  createJam(title: string, createdBy: string): Jam {
    const joinCode = createJoinCode();
    const jam: Jam = {
      id: createId("jam"),
      organizationId: "org_demo",
      title,
      joinCode,
      joinUrl: `/join/${joinCode}`,
      status: "planned",
      createdBy,
      createdAt: nowIso()
    };
    this.jams.set(jam.id, jam);
    return jam;
  }

  attachGameToJam(jamId: string, gameVersionId: string, isDefault = false) {
    const orderIndex =
      [...this.jamGames.values()].filter((item) => item.jamId === jamId).length + 1;

    const relation: JamGame = {
      id: createId("jam_game"),
      jamId,
      gameVersionId,
      isDefault,
      orderIndex
    };
    this.jamGames.set(relation.id, relation);
    return relation;
  }

  updateJamStatus(id: string, status: Jam["status"]) {
    const jam = this.jams.get(id);
    if (!jam) {
      throw new NotFoundException(`Jam ${id} not found`);
    }
    const next: Jam = {
      ...jam,
      status,
      startedAt: status === "active" ? nowIso() : jam.startedAt,
      endedAt: status === "completed" ? nowIso() : jam.endedAt
    };
    this.jams.set(id, next);
    return next;
  }

  getJamByJoinCode(joinCode: string) {
    return [...this.jams.values()].find((jam) => jam.joinCode === joinCode);
  }

  joinJam(joinCode: string, displayName: string, avatar: string) {
    const jam = this.getJamByJoinCode(joinCode);
    if (!jam) {
      throw new NotFoundException(`Join code ${joinCode} not found`);
    }
    const participant: Participant = {
      id: createId("participant"),
      jamId: jam.id,
      displayName,
      avatar,
      status: "active",
      joinedAt: nowIso(),
      lastSeenAt: nowIso()
    };
    this.participants.set(participant.id, participant);
    return participant;
  }

  createParticipantProgress(participantId: string, gameVersionId: string) {
    const version = this.requireVersion(gameVersionId);
    const steps = version.snapshotJson.steps;
    const firstStep = steps[0];

    const progress: ParticipantProgress = {
      id: createId("progress"),
      participantId,
      gameVersionId,
      currentStepId: firstStep.id,
      completedStepsCount: 0,
      totalStepsCount: steps.length,
      xpTotal: 0,
      isCompleted: false,
      startedAt: nowIso()
    };

    this.progress.set(participantId, progress);

    steps.forEach((step: GameStep, index: number) => {
      const stepProgress: ParticipantStepProgress = {
        id: createId("step_progress"),
        participantId,
        gameVersionId,
        stepId: step.id,
        status: index === 0 ? "active" : "locked",
        startedAt: index === 0 ? nowIso() : undefined,
        hintsOpenedCount: 0,
        lastHintLevelOpened: 0,
        needsHelpFlag: false
      };
      this.stepProgress.set(stepProgress.id, stepProgress);
    });

    return progress;
  }

  getParticipantProgress(participantId: string) {
    return this.progress.get(participantId);
  }

  getParticipantStepProgress(participantId: string, stepId: string) {
    return [...this.stepProgress.values()].find((item) => item.participantId === participantId && item.stepId === stepId);
  }

  openNextHint(participantId: string, stepId: string) {
    const progress = this.getParticipantStepProgress(participantId, stepId);
    if (!progress) {
      throw new NotFoundException("Step progress not found");
    }

    const nextLevel = (progress.lastHintLevelOpened + 1) as 1 | 2 | 3 | 4;
    if (nextLevel > 3) {
      throw new Error("All hints are already opened");
    }

    const hint = this.getStepHints(stepId).find((item) => item.level === nextLevel);
    if (!hint) {
      throw new Error(`Hint level ${nextLevel} not found`);
    }

    const next = {
      ...progress,
      hintsOpenedCount: progress.hintsOpenedCount + 1,
      lastHintLevelOpened: nextLevel as 1 | 2 | 3
    };

    this.stepProgress.set(progress.id, next);
    return hint;
  }

  requestHelp(participantId: string, stepId: string) {
    const stepProgress = this.getParticipantStepProgress(participantId, stepId);
    if (!stepProgress) {
      throw new NotFoundException("Step progress not found");
    }
    const next = {
      ...stepProgress,
      needsHelpFlag: true,
      needsHelpAt: nowIso()
    };
    this.stepProgress.set(stepProgress.id, next);

    const participant = this.participants.get(participantId);
    if (participant) {
      this.participants.set(participantId, { ...participant, status: "needs_help", lastSeenAt: nowIso() });
    }

    return next;
  }

  resolveHelp(participantId: string) {
    for (const item of this.stepProgress.values()) {
      if (item.participantId === participantId && item.needsHelpFlag) {
        this.stepProgress.set(item.id, {
          ...item,
          needsHelpFlag: false,
          helpResolvedAt: nowIso()
        });
      }
    }
    const participant = this.participants.get(participantId);
    if (participant) {
      this.participants.set(participantId, { ...participant, status: "active", lastSeenAt: nowIso() });
    }
  }

  completeStep(participantId: string, stepId: string) {
    const progress = this.progress.get(participantId);
    if (!progress) {
      throw new NotFoundException("Progress not found");
    }
    const version = this.requireVersion(progress.gameVersionId);
    const steps = version.snapshotJson.steps;
    const currentIndex = steps.findIndex((step: GameStep) => step.id === stepId);
    if (currentIndex === -1) {
      throw new NotFoundException("Step not found in version");
    }
    if (progress.currentStepId !== stepId) {
      throw new Error("Only the active step can be completed");
    }

    const stepProgress = this.getParticipantStepProgress(participantId, stepId);
    if (!stepProgress) {
      throw new NotFoundException("Step progress missing");
    }

    this.stepProgress.set(stepProgress.id, {
      ...stepProgress,
      status: "completed",
      completedAt: nowIso(),
      needsHelpFlag: false
    });

    const nextStep = steps[currentIndex + 1];
    if (nextStep) {
      const nextStepProgress = this.getParticipantStepProgress(participantId, nextStep.id);
      if (nextStepProgress) {
        this.stepProgress.set(nextStepProgress.id, {
          ...nextStepProgress,
          status: "active",
          startedAt: nextStepProgress.startedAt ?? nowIso()
        });
      }
    }

    const nextProgress: ParticipantProgress = {
      ...progress,
      currentStepId: nextStep?.id ?? stepId,
      completedStepsCount: progress.completedStepsCount + 1,
      xpTotal: progress.xpTotal + steps[currentIndex].successXp,
      isCompleted: !nextStep,
      completedAt: nextStep ? undefined : nowIso()
    };
    this.progress.set(participantId, nextProgress);

    const participant = this.participants.get(participantId);
    if (participant) {
      this.participants.set(participantId, {
        ...participant,
        status: nextStep ? "active" : "completed",
        lastSeenAt: nowIso()
      });
    }

    return nextProgress;
  }

  listTrainerParticipants(jamId: string): TrainerParticipantView[] {
    return [...this.participants.values()]
      .filter((participant) => participant.jamId === jamId)
      .map((participant) => {
        const participantProgress = this.progress.get(participant.id);
        const version = participantProgress ? this.versions.get(participantProgress.gameVersionId) : undefined;
        const currentStep = version?.snapshotJson.steps.find((step: GameStep) => step.id === participantProgress?.currentStepId);
        const stepProgressItems = [...this.stepProgress.values()].filter((item) => item.participantId === participant.id);
        return {
          participant,
          gameTitle: version?.snapshotJson.game.title,
          currentStepTitle: currentStep?.title,
          progressPercent: participantProgress
            ? Math.round((participantProgress.completedStepsCount / participantProgress.totalStepsCount) * 100)
            : 0,
          hintsOpenedCount: stepProgressItems.reduce((sum, item) => sum + item.hintsOpenedCount, 0),
          lastActivityAt: participant.lastSeenAt
        };
      });
  }
}
