import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type Game as PrismaGame, type GameStatus as PrismaGameStatus } from "@prisma/client";
import type {
  AdminGameTemplate,
  CreateHintDto,
  CreateGameDto,
  CreateStepDto,
  ReorderStepsDto,
  UpdateHintDto,
  UpdateGameDto,
  UpdateStepDto
} from "@game-game/shared";
import type { AdminGameDetail, Game, GameEditLock, GameSnapshot, GameStep, GameVersion, StepHint } from "@game-game/shared";
import { PrismaService } from "../../prisma/prisma.service.js";

const adminInclude = {
  steps: {
    orderBy: { orderIndex: "asc" as const },
    include: {
      hints: {
        orderBy: { level: "asc" as const }
      }
    }
  },
  versions: {
    orderBy: { versionNumber: "desc" as const }
  },
  editLock: {
    include: {
      user: true
    }
  }
};

type PrismaGameWithRelations = Prisma.GameGetPayload<{ include: typeof adminInclude }>;
const GAME_EDIT_LOCK_TTL_MS = 2 * 60 * 1000;

@Injectable()
export class ContentRepository {
  constructor(private readonly prisma: PrismaService) {}

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

  async listGames(organizationId: string): Promise<Game[]> {
    const games = await this.prisma.game.findMany({
      where: { organizationId, isTemplate: false },
      orderBy: { updatedAt: "desc" }
    });
    return games.map((game) => this.toGame(game));
  }

  async createGame(dto: CreateGameDto, organizationId: string, userId: string): Promise<Game> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId }
    }) as { isActive: boolean } | null;
    if (!organization?.isActive) {
      throw new ConflictException("Organization is not active");
    }

    const game = await this.prisma.game.create({
      data: {
        organizationId,
        slug: dto.slug,
        isTemplate: dto.isTemplate ?? false,
        title: dto.title,
        shortDescription: dto.shortDescription,
        fullDescription: dto.fullDescription,
        themeCode: dto.themeCode,
          level: dto.level,
          estimatedDurationMin: dto.estimatedDurationMin,
          accentStyle: dto.accentStyle,
          accentColor: dto.accentColor,
          coverImageUrl: dto.coverImageUrl,
          previewVideoUrl: dto.previewVideoUrl,
          finalTitle: dto.finalTitle,
          finalDescription: dto.finalDescription,
          finalRewardXp: dto.finalRewardXp,
        createdById: userId,
        updatedById: userId
      }
    });

    return this.toGame(game);
  }

  async getGameDetail(id: string, organizationId: string, currentUserId?: string): Promise<AdminGameDetail> {
    const game = await this.prisma.game.findFirst({
      where: { id, organizationId },
      include: adminInclude
    });

    if (!game) {
      throw new NotFoundException(`Game ${id} not found`);
    }

    return this.toAdminGameDetail(game, currentUserId);
  }

  async acquireGameEditLock(gameId: string, organizationId: string, user: { id: string; displayName: string }) {
    await this.cleanupExpiredLocks();
    const game = await this.prisma.game.findFirst({
      where: { id: gameId, organizationId },
      include: {
        editLock: {
          include: {
            user: true
          }
        }
      }
    });

    if (!game) {
      throw new NotFoundException(`Game ${gameId} not found`);
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + GAME_EDIT_LOCK_TTL_MS);
    const currentLock = game.editLock;

    if (currentLock && currentLock.expiresAt > now && currentLock.userId !== user.id) {
      throw new ConflictException(`Game is currently being edited by ${currentLock.user.displayName}`);
    }

    // upsert prevents race conditions when the same user acquires lock concurrently (e.g. React Strict Mode double-invoke)
    const lock = await this.prisma.gameEditLock.upsert({
      where: { gameId },
      create: {
        gameId,
        organizationId,
        userId: user.id,
        acquiredAt: now,
        expiresAt
      },
      update: {
        userId: user.id,
        organizationId,
        acquiredAt: now,
        expiresAt
      },
      include: {
        user: true
      }
    });

    return this.toGameEditLock(lock, user.id);
  }

  async releaseGameEditLock(gameId: string, organizationId: string, userId: string) {
    const lock = await this.prisma.gameEditLock.findFirst({
      where: { gameId, organizationId }
    });

    if (!lock) {
      return { ok: true };
    }

    if (lock.userId !== userId) {
      throw new ConflictException("Only the lock owner can release this edit lock.");
    }

    await this.prisma.gameEditLock.delete({
      where: { gameId }
    });

    return { ok: true };
  }

  async updateGame(id: string, dto: UpdateGameDto, organizationId: string, userId: string): Promise<Game> {
    const existing = await this.prisma.game.findFirst({ where: { id, organizationId } });
    if (!existing) {
      throw new NotFoundException(`Game ${id} not found`);
    }
    if (dto.expectedUpdatedAt && existing.updatedAt.toISOString() !== dto.expectedUpdatedAt) {
      throw new ConflictException("Game draft was updated by another editor. Refresh before saving again.");
    }

    const game = await this.prisma.game.update({
      where: { id },
      data: {
        slug: dto.slug,
        isTemplate: dto.isTemplate,
        title: dto.title,
        shortDescription: dto.shortDescription,
        fullDescription: dto.fullDescription,
        themeCode: dto.themeCode,
          level: dto.level,
          estimatedDurationMin: dto.estimatedDurationMin,
          accentStyle: dto.accentStyle,
          accentColor: dto.accentColor,
          coverImageUrl: dto.coverImageUrl,
          previewVideoUrl: dto.previewVideoUrl,
          finalTitle: dto.finalTitle,
          finalDescription: dto.finalDescription,
          finalRewardXp: dto.finalRewardXp,
        status: existing.status === "published" ? "draft" : undefined,
        updatedById: userId
      }
    });

    return this.toGame(game);
  }

  async duplicateGame(id: string, organizationId: string, userId: string): Promise<Game> {
    const detail = await this.getGameDetail(id, organizationId);
    const copy = await this.createGame({
      slug: `${detail.game.slug}-copy`,
      isTemplate: detail.game.isTemplate,
      title: `${detail.game.title} Copy`,
      shortDescription: detail.game.shortDescription,
      fullDescription: detail.game.fullDescription,
      themeCode: detail.game.themeCode,
        level: detail.game.level,
        estimatedDurationMin: detail.game.estimatedDurationMin,
        accentStyle: detail.game.accentStyle,
        accentColor: detail.game.accentColor,
        coverImageUrl: detail.game.coverImageUrl,
        previewVideoUrl: detail.game.previewVideoUrl,
        finalTitle: detail.game.finalTitle,
      finalDescription: detail.game.finalDescription,
      finalRewardXp: detail.game.finalRewardXp
    }, organizationId, userId);

    for (const step of detail.steps) {
      const createdStep = await this.createStep(copy.id, {
        title: step.title,
        description: step.description,
        goalText: step.goalText,
        taskImageUrl: step.taskImageUrl,
        taskVideoUrl: step.taskVideoUrl,
        resultImageUrl: step.resultImageUrl,
        resultVideoUrl: step.resultVideoUrl,
        successTitle: step.successTitle,
        successText: step.successText,
        successXp: step.successXp
      });

      for (const hint of step.hints) {
        await this.createHint(createdStep.id, {
          level: hint.level,
          text: hint.text,
          hintType: hint.hintType,
          mediaUrl: hint.mediaUrl
        });
      }
    }

    return copy;
  }

  async archiveGame(id: string, organizationId: string, userId: string): Promise<Game> {
    const existing = await this.prisma.game.findFirst({ where: { id, organizationId } });
    if (!existing) {
      throw new NotFoundException(`Game ${id} not found`);
    }
    const game = await this.prisma.game.update({
      where: { id },
      data: {
        status: "archived",
        updatedById: userId
      }
    });
    return this.toGame(game);
  }

  async deleteGame(id: string, organizationId: string): Promise<{ ok: true }> {
    const existing = await this.prisma.game.findFirst({
      where: { id, organizationId },
      include: {
        versions: {
          select: { id: true }
        }
      }
    });

    if (!existing) {
      throw new NotFoundException(`Game ${id} not found`);
    }

    if (existing.status === "published") {
      throw new ConflictException("Нельзя удалить опубликованный джем. Сначала переведите его в архив.");
    }

    const versionIds = existing.versions.map((v) => v.id);

    await this.prisma.$transaction(async (tx) => {
      // Каскадное удаление зависимостей версий (для архивированных джемов)
      if (versionIds.length > 0) {
        await tx.participantStepProgress.deleteMany({
          where: { gameVersionId: { in: versionIds } }
        });
        await tx.participantProgress.deleteMany({
          where: { gameVersionId: { in: versionIds } }
        });
        await tx.jamGame.deleteMany({
          where: { gameVersionId: { in: versionIds } }
        });
        await tx.gameVersion.deleteMany({
          where: { gameId: id }
        });
      }

      await tx.stepHint.deleteMany({
        where: { step: { gameId: id } }
      });

      await tx.gameStep.deleteMany({
        where: { gameId: id }
      });

      await tx.gameEditLock.deleteMany({
        where: { gameId: id }
      });

      await tx.game.delete({
        where: { id }
      });
    });

    return { ok: true };
  }

  async createStep(gameId: string, dto: CreateStepDto): Promise<GameStep> {
    const orderIndex = (await this.prisma.gameStep.count({ where: { gameId } })) + 1;
    const step = await this.prisma.gameStep.create({
      data: {
        gameId,
        orderIndex,
        title: dto.title,
        description: dto.description,
        goalText: dto.goalText,
        taskImageUrl: dto.taskImageUrl,
        taskVideoUrl: dto.taskVideoUrl,
        resultImageUrl: dto.resultImageUrl,
        resultVideoUrl: dto.resultVideoUrl,
        successTitle: dto.successTitle,
        successText: dto.successText,
        successXp: dto.successXp
      }
    });

    return this.toGameStep(step);
  }

  async updateStep(stepId: string, dto: UpdateStepDto): Promise<GameStep> {
    const existing = await this.prisma.gameStep.findUnique({
      where: { id: stepId }
    });

    if (!existing) {
      throw new NotFoundException(`Step ${stepId} not found`);
    }

    if (dto.expectedUpdatedAt && existing.updatedAt.toISOString() !== dto.expectedUpdatedAt) {
      throw new ConflictException("Step was updated by another editor. Refresh before saving again.");
    }

    const step = await this.prisma.gameStep.update({
      where: { id: stepId },
      data: {
        title: dto.title,
        description: dto.description,
        goalText: dto.goalText,
        taskImageUrl: dto.taskImageUrl,
        taskVideoUrl: dto.taskVideoUrl,
        resultImageUrl: dto.resultImageUrl,
        resultVideoUrl: dto.resultVideoUrl,
        successTitle: dto.successTitle,
        successText: dto.successText,
        successXp: dto.successXp,
        isActive: dto.isActive
      }
    });

    return this.toGameStep(step);
  }

  async deleteStep(stepId: string) {
    await this.prisma.gameStep.delete({ where: { id: stepId } });
    return { ok: true };
  }

  async reorderSteps(gameId: string, dto: ReorderStepsDto) {
    await this.prisma.$transaction(
      dto.stepIds.map((stepId, index) =>
        this.prisma.gameStep.update({
          where: { id: stepId },
          data: { orderIndex: index + 1 }
        })
      )
    );

    return this.getGameDetail(gameId, (await this.prisma.game.findUniqueOrThrow({ where: { id: gameId } })).organizationId);
  }

  async createHint(stepId: string, dto: CreateHintDto): Promise<StepHint> {
    const hint = await this.prisma.stepHint.create({
      data: {
        stepId,
        level: dto.level,
        text: dto.text,
        hintType: dto.hintType,
        mediaUrl: dto.mediaUrl
      }
    });
    return this.toStepHint(hint);
  }

  async updateHint(hintId: string, dto: UpdateHintDto): Promise<StepHint> {
    const hint = await this.prisma.stepHint.update({
      where: { id: hintId },
      data: {
        level: dto.level,
        text: dto.text,
        hintType: dto.hintType,
        mediaUrl: dto.mediaUrl
      }
    });
    return this.toStepHint(hint);
  }

  async deleteHint(hintId: string) {
    await this.prisma.stepHint.delete({ where: { id: hintId } });
    return { ok: true };
  }

  async listVersions(gameId: string): Promise<GameVersion[]> {
    const versions = await this.prisma.gameVersion.findMany({
      where: { gameId },
      orderBy: { versionNumber: "desc" }
    });

    return versions.map((version) => this.toGameVersion(version));
  }

  async listPublishedVersions(organizationId: string): Promise<GameVersion[]> {
    const versions = await this.prisma.gameVersion.findMany({
      where: { isPublishedVersion: true, game: { organizationId, isTemplate: false } },
      orderBy: [{ createdAt: "desc" }]
    });

    return versions.map((version) => this.toGameVersion(version));
  }

  async listTemplates(organizationId: string): Promise<AdminGameTemplate[]> {
    const templates = await this.prisma.game.findMany({
      where: { organizationId, isTemplate: true },
      include: {
        steps: {
          include: {
            hints: true
          }
        }
      },
      orderBy: [{ updatedAt: "desc" }]
    });

    return templates.map((template) => ({
      gameId: template.id,
      gameTitle: template.title,
      shortDescription: template.shortDescription,
      level: template.level,
      estimatedDurationMin: template.estimatedDurationMin,
      status: template.status,
      stepsCount: template.steps.length,
      hintsCount: template.steps.reduce((sum, step) => sum + step.hints.length, 0),
      createdAt: template.createdAt.toISOString(),
      updatedAt: template.updatedAt.toISOString()
    }));
  }

  async getVersion(versionId: string, organizationId: string): Promise<GameVersion> {
    const version = await this.prisma.gameVersion.findFirst({
      where: { id: versionId, game: { organizationId } }
    });

    if (!version) {
      throw new NotFoundException(`Version ${versionId} not found`);
    }

    return this.toGameVersion(version);
  }

  async restoreGameFromVersion(versionId: string, organizationId: string, userId: string): Promise<AdminGameDetail> {
    const version = await this.prisma.gameVersion.findFirst({
      where: {
        id: versionId,
        game: {
          organizationId
        }
      },
      include: {
        game: true
      }
    });

    if (!version) {
      throw new NotFoundException(`Version ${versionId} not found`);
    }

    const snapshot = version.snapshotJson as unknown as GameSnapshot;

    await this.prisma.$transaction(async (tx) => {
      await tx.stepHint.deleteMany({
        where: {
          step: {
            gameId: version.gameId
          }
        }
      });

      await tx.gameStep.deleteMany({
        where: {
          gameId: version.gameId
        }
      });

      await tx.game.update({
        where: { id: version.gameId },
        data: {
          slug: snapshot.game.slug,
          title: snapshot.game.title,
          shortDescription: snapshot.game.shortDescription,
          fullDescription: snapshot.game.fullDescription,
          themeCode: snapshot.game.themeCode,
          level: snapshot.game.level,
          estimatedDurationMin: snapshot.game.estimatedDurationMin,
          coverImageUrl: snapshot.game.coverImageUrl,
          previewVideoUrl: snapshot.game.previewVideoUrl,
          accentStyle: snapshot.game.accentStyle,
          accentColor: snapshot.game.accentColor,
          finalTitle: snapshot.game.finalTitle,
          finalDescription: snapshot.game.finalDescription,
          finalRewardXp: snapshot.game.finalRewardXp,
          status: "draft",
          updatedById: userId
        }
      });

      for (const step of snapshot.steps) {
        const createdStep = await tx.gameStep.create({
          data: {
            gameId: version.gameId,
            orderIndex: step.orderIndex,
            title: step.title,
            description: step.description,
            goalText: step.goalText,
            taskImageUrl: step.taskImageUrl,
            taskVideoUrl: step.taskVideoUrl,
            resultVideoUrl: step.resultVideoUrl,
            resultImageUrl: step.resultImageUrl,
            successTitle: step.successTitle,
            successText: step.successText,
            successXp: step.successXp,
            isActive: step.isActive
          }
        });

        if (step.hints.length > 0) {
          await tx.stepHint.createMany({
            data: step.hints.map((hint) => ({
              stepId: createdStep.id,
              level: hint.level,
              text: hint.text,
              hintType: hint.hintType,
              mediaUrl: hint.mediaUrl
            }))
          });
        }
      }
    });

    return this.getGameDetail(version.gameId, organizationId, userId);
  }

  async createGameFromTemplate(templateId: string, organizationId: string, userId: string): Promise<Game> {
    const detail = await this.getGameDetail(templateId, organizationId, userId);

    if (!detail.game.isTemplate) {
      throw new ConflictException("Указанный джем не является шаблоном.");
    }

    const slugBase = detail.game.slug
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "template";

    const created = await this.createGame({
      slug: `${slugBase}-${Date.now()}`,
      isTemplate: false,
      title: `${detail.game.title} Copy`,
      shortDescription: detail.game.shortDescription,
      fullDescription: detail.game.fullDescription,
      themeCode: detail.game.themeCode,
      level: detail.game.level,
      estimatedDurationMin: detail.game.estimatedDurationMin,
      accentStyle: detail.game.accentStyle,
      accentColor: detail.game.accentColor,
      coverImageUrl: detail.game.coverImageUrl,
      previewVideoUrl: detail.game.previewVideoUrl,
      finalTitle: detail.game.finalTitle,
      finalDescription: detail.game.finalDescription,
      finalRewardXp: detail.game.finalRewardXp
    }, organizationId, userId);

    for (const step of detail.steps) {
      const createdStep = await this.createStep(created.id, {
        title: step.title,
        description: step.description,
        goalText: step.goalText,
        taskImageUrl: step.taskImageUrl,
        taskVideoUrl: step.taskVideoUrl,
        resultImageUrl: step.resultImageUrl,
        resultVideoUrl: step.resultVideoUrl,
        successTitle: step.successTitle,
        successText: step.successText,
        successXp: step.successXp
      });

      for (const hint of step.hints) {
        await this.createHint(createdStep.id, {
          level: hint.level,
          text: hint.text,
          hintType: hint.hintType,
          mediaUrl: hint.mediaUrl
        });
      }
    }

    return created;
  }

  async heartbeatGameEditLock(gameId: string, organizationId: string, userId: string) {
    await this.cleanupExpiredLocks();
    const lock = await this.prisma.gameEditLock.findFirst({
      where: { gameId, organizationId },
      include: {
        user: true
      }
    });

    if (!lock) {
      throw new NotFoundException("Edit lock not found");
    }

    if (lock.userId !== userId) {
      throw new ConflictException(`Game is currently being edited by ${lock.user.displayName}`);
    }

    const refreshed = await this.prisma.gameEditLock.update({
      where: { gameId },
      data: {
        expiresAt: new Date(Date.now() + GAME_EDIT_LOCK_TTL_MS)
      },
      include: {
        user: true
      }
    });

    return this.toGameEditLock(refreshed, userId);
  }

  async publishGame(id: string, organizationId: string, userId: string): Promise<GameVersion> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId }
    }) as { isActive: boolean; maxPublishedGames: number } | null;
    if (!organization?.isActive) {
      throw new Error("Organization is not active");
    }

    const publishedGamesCount = await this.prisma.game.count({
      where: {
        organizationId,
        status: "published"
      }
    });
    if (publishedGamesCount >= organization.maxPublishedGames) {
      throw new Error("Organization has reached the published game limit for the current plan");
    }

    const game = await this.prisma.game.findFirst({
      where: { id, organizationId },
      include: {
        steps: {
          orderBy: { orderIndex: "asc" },
          include: {
            hints: {
              orderBy: { level: "asc" }
            }
          }
        },
        versions: true
      }
    });

    if (!game) {
      throw new NotFoundException(`Game ${id} not found`);
    }

    if (game.isTemplate) {
      throw new Error("Шаблон нельзя публиковать. Сначала создайте обычный джем из шаблона.");
    }

    if (game.steps.length === 0) {
      throw new Error("Cannot publish a game without steps");
    }

    if (!game.title.trim() || !game.shortDescription.trim() || !game.fullDescription.trim()) {
      throw new Error("Game metadata is incomplete");
    }

    if (!game.finalTitle.trim() || !game.finalDescription.trim()) {
      throw new Error("Final screen is incomplete");
    }

    if (game.estimatedDurationMin < 15 || game.estimatedDurationMin > 90) {
      throw new Error("Estimated duration must be between 15 and 90 minutes");
    }

    if (game.finalRewardXp <= 0) {
      throw new Error("Final reward XP must be greater than 0");
    }

    if (game.steps.some((step) => !step.title.trim())) {
      throw new Error("Cannot publish a game with untitled steps");
    }

    for (const [index, step] of game.steps.entries()) {
      if (step.orderIndex !== index + 1) {
        throw new Error("Step order must be sequential before publish");
      }

      if (!step.description.trim() || !step.goalText.trim()) {
        throw new Error("Each step requires description and goal text");
      }

      if (!step.successTitle.trim() || !step.successText.trim()) {
        throw new Error("Each step requires success copy");
      }

      if (step.successXp <= 0) {
        throw new Error("Each step must grant XP greater than 0");
      }

      // Hints are optional. If a step has any, their levels must still be
      // valid: unique and numbered sequentially starting from L1.
      if (step.hints.length > 0) {
        const levels = step.hints.map((hint) => hint.level);
        const uniqueLevels = new Set(levels);
        if (uniqueLevels.size !== levels.length) {
          throw new Error(`Step "${step.title}" has duplicate hint levels`);
        }

        const sortedLevels = [...levels].sort((left, right) => left - right);
        const isSequential = sortedLevels.every((level, index) => level === index + 1);
        if (!isSequential) {
          throw new Error(`Step "${step.title}" hints must be numbered sequentially starting from L1`);
        }

        if (step.hints.some((hint) => !hint.text.trim())) {
          throw new Error(`Step "${step.title}" has a hint without text`);
        }
      }
    }
    const versionNumber = Math.max(0, ...game.versions.map((version) => version.versionNumber)) + 1;

    const snapshot: GameSnapshot = {
      game: this.toGame({
        ...game,
        status: "published",
        publishedAt: new Date()
      }),
      steps: game.steps.map((step) => ({
        ...this.toGameStep(step),
        hints: step.hints.map((hint) => this.toStepHint(hint))
      })),
      finalScreen: {
        title: game.finalTitle,
        description: game.finalDescription,
        rewardXp: game.finalRewardXp
      }
    };

    const version = await this.prisma.$transaction(async (tx) => {
      await tx.game.update({
        where: { id },
        data: {
          status: "published",
          publishedAt: new Date(),
          updatedById: userId
        }
      });

      return tx.gameVersion.create({
        data: {
          gameId: id,
          versionNumber,
          snapshotJson: snapshot as unknown as Prisma.InputJsonValue,
          createdBy: userId,
          isPublishedVersion: true
        }
      });
    });

    return this.toGameVersion(version);
  }

  private toAdminGameDetail(game: PrismaGameWithRelations, currentUserId?: string): AdminGameDetail {
    return {
      game: this.toGame(game),
      steps: game.steps.map((step) => ({
        ...this.toGameStep(step),
        hints: step.hints.map((hint) => this.toStepHint(hint))
      })),
      versions: game.versions.map((version) => this.toGameVersion(version)),
      editLock: game.editLock ? this.toGameEditLock(game.editLock, currentUserId) : undefined
    };
  }

  private async cleanupExpiredLocks() {
    await this.prisma.gameEditLock.deleteMany({
      where: {
        expiresAt: {
          lte: new Date()
        }
      }
    });
  }

  private toGame(game: PrismaGame & { status: PrismaGameStatus }): Game {
    return {
      id: game.id,
      organizationId: game.organizationId,
      slug: game.slug,
      isTemplate: game.isTemplate,
      title: game.title,
      shortDescription: game.shortDescription,
      fullDescription: game.fullDescription,
      themeCode: game.themeCode,
      level: game.level,
      estimatedDurationMin: game.estimatedDurationMin,
      coverImageUrl: game.coverImageUrl ?? undefined,
      previewVideoUrl: game.previewVideoUrl ?? undefined,
      accentStyle: game.accentStyle,
      accentColor: game.accentColor,
      finalTitle: game.finalTitle,
      finalDescription: game.finalDescription,
      finalRewardXp: game.finalRewardXp,
      status: game.status,
      publishedAt: game.publishedAt?.toISOString(),
      createdAt: game.createdAt.toISOString(),
      updatedAt: game.updatedAt.toISOString(),
      createdBy: game.createdById,
      updatedBy: game.updatedById
    };
  }

  private toGameStep(step: {
    id: string;
    gameId: string;
    orderIndex: number;
    title: string;
    description: string;
    goalText: string;
    taskImageUrl: string | null;
    taskVideoUrl: string | null;
    resultVideoUrl: string | null;
    resultImageUrl: string | null;
    successTitle: string;
    successText: string;
    successXp: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): GameStep {
    return {
      id: step.id,
      gameId: step.gameId,
      orderIndex: step.orderIndex,
      title: step.title,
      description: step.description,
      goalText: step.goalText,
      taskImageUrl: step.taskImageUrl ?? undefined,
      taskVideoUrl: step.taskVideoUrl ?? undefined,
      resultVideoUrl: step.resultVideoUrl ?? undefined,
      resultImageUrl: step.resultImageUrl ?? undefined,
      successTitle: step.successTitle,
      successText: step.successText,
      successXp: step.successXp,
      isActive: step.isActive,
      createdAt: step.createdAt.toISOString(),
      updatedAt: step.updatedAt.toISOString()
    };
  }

  private toStepHint(hint: {
    id: string;
    stepId: string;
    level: number;
    text: string;
    hintType: "text" | "image" | "video";
    mediaUrl: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): StepHint {
    return {
      id: hint.id,
      stepId: hint.stepId,
      level: hint.level as 1 | 2 | 3,
      text: hint.text,
      hintType: hint.hintType,
      mediaUrl: hint.mediaUrl ?? undefined,
      createdAt: hint.createdAt.toISOString(),
      updatedAt: hint.updatedAt.toISOString()
    };
  }

  private toGameVersion(version: {
    id: string;
    gameId: string;
    versionNumber: number;
    snapshotJson: Prisma.JsonValue;
    createdAt: Date;
    createdBy: string;
    isPublishedVersion: boolean;
  }): GameVersion {
    return {
      id: version.id,
      gameId: version.gameId,
      versionNumber: version.versionNumber,
      snapshotJson: version.snapshotJson as unknown as GameSnapshot,
      createdAt: version.createdAt.toISOString(),
      createdBy: version.createdBy,
      isPublishedVersion: version.isPublishedVersion
    };
  }

  private toGameEditLock(lock: {
    id: string;
    gameId: string;
    organizationId: string;
    userId: string;
    acquiredAt: Date;
    expiresAt: Date;
    user: { displayName: string };
  }, currentUserId?: string): GameEditLock {
    return {
      id: lock.id,
      gameId: lock.gameId,
      organizationId: lock.organizationId,
      userId: lock.userId,
      userDisplayName: lock.user.displayName,
      acquiredAt: lock.acquiredAt.toISOString(),
      expiresAt: lock.expiresAt.toISOString(),
      isOwnedByCurrentUser: currentUserId ? lock.userId === currentUserId : undefined
    };
  }
}
