import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { createJoinCode } from "../../common/utils.js";
import { ProgressRepository } from "./progress.repository.js";
import type {
  AttachJamGameDto,
  CreateJamDto,
  JoinSessionDto,
  Participant,
  PublicJamPayload,
  Jam,
  JamDetail,
  JamGame
} from "@game-game/shared";

@Injectable()
export class SessionRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly progressRepository: ProgressRepository
  ) {}

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

  async createJam(dto: CreateJamDto, organizationId: string): Promise<Jam> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId }
    }) as { isActive: boolean; maxActiveJams: number } | null;
    if (!organization?.isActive) {
      throw new BadRequestException("Organization is not active");
    }

    const activeJamsCount = await this.prisma.jam.count({
      where: { organizationId, status: "active" }
    });
    if (activeJamsCount >= organization.maxActiveJams) {
      throw new BadRequestException("Organization has reached the active jam limit for the current plan");
    }

    const joinCode = createJoinCode();
    const jam = await this.prisma.jam.create({
      data: {
        organizationId,
        title: dto.title,
        joinCode,
        joinUrl: `/join/${joinCode}`,
        status: "planned",
        createdBy: "trainer_system"
      }
    });

    return this.toJam(jam);
  }

  async listJams(organizationId: string): Promise<Jam[]> {
    const jams = await this.prisma.jam.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" }
    });
    const jamIds = jams.map((jam) => jam.id);
    const participants = jamIds.length
      ? await this.prisma.participant.findMany({
          where: {
            jamId: { in: jamIds }
          }
        })
      : [];
    const participantIds = participants.map((participant) => participant.id);
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

    return jams.map((jam) => {
      const jamParticipants = participants.filter((participant) => participant.jamId === jam.id);
      const jamParticipantIds = new Set(jamParticipants.map((participant) => participant.id));
      const jamProgress = progressItems.filter((item) => jamParticipantIds.has(item.participantId));
      const jamSteps = stepItems.filter((item) => jamParticipantIds.has(item.participantId));

      return this.toJam(jam, {
        participantsCount: jamParticipants.length,
        completedCount: jamProgress.filter((item) => item.isCompleted).length,
        reviewedCount: jamProgress.filter((item) => item.reviewedAt).length,
        averageProgressPercent:
          jamProgress.length > 0
            ? Math.round(
                jamProgress.reduce(
                  (sum, item) => sum + Math.round((item.completedStepsCount / item.totalStepsCount) * 100),
                  0
                ) / jamProgress.length
              )
            : 0,
        helpRequestsCount: jamSteps.filter((item) => item.needsHelpAt).length,
        hintsOpenedCount: jamSteps.reduce((sum, item) => sum + item.hintsOpenedCount, 0)
      });
    });
  }

  async getJam(id: string, organizationId: string): Promise<JamDetail> {
    const jam = await this.prisma.jam.findFirst({
      where: { id, organizationId },
      include: {
        jamGames: {
          orderBy: { orderIndex: "asc" }
        }
      }
    });

    if (!jam) {
      throw new NotFoundException(`Jam ${id} not found`);
    }

    return {
      jam: this.toJam(jam),
      jamGames: jam.jamGames.map((item) => this.toJamGame(item)),
      participants: await this.progressRepository.getTrainerParticipants(id)
    };
  }

  async updateJamStatus(id: string, organizationId: string, status: Jam["status"]): Promise<Jam> {
    const existing = await this.prisma.jam.findFirst({ where: { id, organizationId } });
    if (!existing) {
      throw new NotFoundException(`Jam ${id} not found`);
    }
    const jam = await this.prisma.jam.update({
      where: { id },
      data: {
        status,
        startedAt: status === "active" ? new Date() : undefined,
        endedAt: status === "completed" ? new Date() : undefined
      }
    });

    return this.toJam(jam);
  }

  async attachJamGame(jamId: string, dto: AttachJamGameDto, organizationId: string): Promise<JamGame> {
    const jam = await this.prisma.jam.findFirst({ where: { id: jamId, organizationId } });
    if (!jam) {
      throw new NotFoundException(`Jam ${jamId} not found`);
    }

    const version = await this.prisma.gameVersion.findFirst({
      where: {
        id: dto.gameVersionId,
        game: {
          organizationId
        }
      }
    });

    if (!version) {
      throw new NotFoundException(`Game version ${dto.gameVersionId} not found`);
    }

    const orderIndex = (await this.prisma.jamGame.count({ where: { jamId } })) + 1;
    const relation = await this.prisma.jamGame.create({
      data: {
        jamId,
        gameVersionId: dto.gameVersionId,
        isDefault: dto.isDefault ?? false,
        orderIndex
      }
    });

    return this.toJamGame(relation);
  }

  async getParticipant(participantId: string) {
    const participant = await this.prisma.participant.findUnique({
      where: { id: participantId },
      include: {
        jam: true
      }
    });

    if (!participant) {
      throw new NotFoundException("Participant not found");
    }

    return {
      participant: this.toParticipant(participant),
      jam: this.toJam(participant.jam),
      progress: null,
      steps: []
    };
  }

  async getPublicJam(joinCode: string): Promise<PublicJamPayload> {
    const jam = await this.prisma.jam.findUnique({
      where: { joinCode },
      include: {
        organization: true,
        jamGames: {
          orderBy: { orderIndex: "asc" },
          include: {
            gameVersion: true
          }
        }
      }
    });

    if (!jam) {
      throw new NotFoundException("Jam not found");
    }

    return {
      jam: this.toJam(jam),
      organization: {
        id: jam.organization.id,
        name: jam.organization.name,
        slug: jam.organization.slug,
        logoUrl: jam.organization.logoUrl ?? undefined,
        brandMessage: jam.organization.brandMessage ?? undefined,
        brandAccentColor: jam.organization.brandAccentColor ?? undefined
      },
      games: jam.jamGames.map((item) => ({
        id: item.gameVersion.id,
        gameId: item.gameVersion.gameId,
        versionNumber: item.gameVersion.versionNumber,
        snapshotJson: item.gameVersion.snapshotJson as never,
        createdAt: item.gameVersion.createdAt.toISOString(),
        createdBy: item.gameVersion.createdBy,
        isPublishedVersion: item.gameVersion.isPublishedVersion
      }))
    };
  }

  async joinJam(joinCode: string, dto: JoinSessionDto): Promise<Participant> {
    const jam = await this.prisma.jam.findUnique({
      where: { joinCode }
    });

    if (!jam) {
      throw new NotFoundException(`Join code ${joinCode} not found`);
    }

    const participant = await this.prisma.participant.create({
      data: {
        jamId: jam.id,
        displayName: dto.displayName,
        avatar: dto.avatar,
        status: "active"
      }
    });

    return this.toParticipant(participant);
  }

  async getParticipantJam(participantId: string) {
    const participant = await this.prisma.participant.findUnique({
      where: { id: participantId }
    });
    if (!participant) {
      throw new NotFoundException("Participant not found");
    }
    return participant.jamId;
  }

  async getParticipantOrganizationId(participantId: string) {
    const participant = await this.prisma.participant.findUnique({
      where: { id: participantId },
      include: {
        jam: true
      }
    });

    if (!participant) {
      throw new NotFoundException("Participant not found");
    }

    return participant.jam.organizationId;
  }

  async listParticipantGameVersionIds(participantId: string): Promise<string[]> {
    const participant = await this.prisma.participant.findUnique({
      where: { id: participantId },
      include: {
        jam: {
          include: {
            jamGames: {
              orderBy: { orderIndex: "asc" }
            }
          }
        }
      }
    });

    if (!participant) {
      throw new NotFoundException("Participant not found");
    }

    return participant.jam.jamGames.map((item) => item.gameVersionId);
  }

  async resolveHelp(participantId: string) {
    const participant = await this.prisma.participant.update({
      where: { id: participantId },
      data: {
        status: "active",
        lastSeenAt: new Date()
      }
    });

    return this.toParticipant(participant);
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
  }, archiveSummary?: Jam["archiveSummary"]): Jam {
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
      createdAt: jam.createdAt.toISOString(),
      archiveSummary
    };
  }

  private toJamGame(item: {
    id: string;
    jamId: string;
    gameVersionId: string;
    isDefault: boolean;
    orderIndex: number;
  }): JamGame {
    return {
      id: item.id,
      jamId: item.jamId,
      gameVersionId: item.gameVersionId,
      isDefault: item.isDefault,
      orderIndex: item.orderIndex
    };
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
}
