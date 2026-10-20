import { Inject, Injectable } from "@nestjs/common";
import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModuleOptions, ThrottlerStorage, getOptionsToken, getStorageToken } from "@nestjs/throttler";
import { SESSION_COOKIE_NAME } from "./auth.constants.js";
import { getCookieValue } from "./cookie.utils.js";
import { PARTICIPANT_SCOPED_KEY } from "./participant-scoped.decorator.js";
import { AuthService } from "../modules/services/auth.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

const PARTICIPANT_CACHE_TTL_MS = 10_000;

/**
 * Default ThrottlerGuard keys every bucket by source IP. That pools every
 * child/trainer behind the same NAT (a classroom network) into one counter,
 * so a handful of kids playing concurrently trips false 429s. Key by
 * participant identity instead, when we have one, and only fall back to IP
 * for everything else — most importantly pre-auth routes like login/join.
 *
 * `x-participant-id` is a client-supplied, unauthenticated header. Two
 * mistakes are possible here, both of which actually happened during
 * review:
 *   1. Trusting an unknown/made-up id — closed by requiring the id to
 *      resolve to a real participant.
 *   2. Trusting the header on routes where participant identity isn't the
 *      point — e.g. /auth/login. Even with (1) fixed, an attacker who
 *      controls two or more REAL participant ids (trivial: joining a jam is
 *      self-service) could attach a different real id per login attempt and
 *      get a fresh bucket every time, fully dodging the brute-force limiter.
 *      Closed by only consulting the header on routes explicitly marked
 *      with @ParticipantScoped() — an opt-in allowlist, so a route defaults
 *      to IP tracking unless a human deliberately decided participant
 *      identity is the right rate-limit axis for it. Existence of the id is
 *      never treated as proof the caller IS that participant — it only
 *      decides which limiter bucket a request's quota is checked against.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  private readonly participantExistsCache = new Map<string, { exists: boolean; expiresAt: number }>();

  constructor(
    @Inject(getOptionsToken()) options: ThrottlerModuleOptions,
    @Inject(getStorageToken()) storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly authService: AuthService,
    private readonly prisma: PrismaService
  ) {
    super(options, storageService, reflector);
  }

  protected async getTracker(req: Record<string, any>, context?: ExecutionContext): Promise<string> {
    const participantScoped = context
      ? this.reflector.getAllAndOverride<boolean>(PARTICIPANT_SCOPED_KEY, [context.getHandler(), context.getClass()])
      : false;

    if (participantScoped) {
      const participantId = req.headers?.["x-participant-id"];
      if (typeof participantId === "string" && participantId.trim()) {
        const id = participantId.trim();
        if (await this.participantExists(id)) {
          return `participant:${id}`;
        }
      }
    }

    const cookieToken = getCookieValue(req.headers?.cookie, SESSION_COOKIE_NAME);
    if (cookieToken) {
      try {
        const session = await this.authService.getSessionByToken(cookieToken);
        if (session?.user?.id) {
          return `user:${session.user.id}`;
        }
      } catch {
        // fall through to IP-based tracking below
      }
    }

    return req.ip ?? "unknown";
  }

  private async participantExists(id: string): Promise<boolean> {
    const cached = this.participantExistsCache.get(id);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.exists;
    }

    let exists = false;
    try {
      exists = (await this.prisma.participant.findUnique({ where: { id }, select: { id: true } })) !== null;
    } catch {
      exists = false;
    }

    this.participantExistsCache.set(id, { exists, expiresAt: now + PARTICIPANT_CACHE_TTL_MS });
    return exists;
  }
}
