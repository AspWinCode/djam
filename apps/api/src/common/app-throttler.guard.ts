import { Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModuleOptions, ThrottlerStorage, getOptionsToken, getStorageToken } from "@nestjs/throttler";
import { SESSION_COOKIE_NAME } from "./auth.constants.js";
import { getCookieValue } from "./cookie.utils.js";
import { AuthService } from "../modules/services/auth.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

const PARTICIPANT_CACHE_TTL_MS = 10_000;

/**
 * Default ThrottlerGuard keys every bucket by source IP. That pools every
 * child/trainer behind the same NAT (a classroom network) into one counter,
 * so a handful of kids playing concurrently trips false 429s. Key by
 * participant/session identity instead, when we have one, and only fall
 * back to IP for pre-auth requests (login, join) where no identity exists yet.
 *
 * `x-participant-id` is a client-supplied, unauthenticated header — trusting
 * it unconditionally would let a request spoof a fresh identity on every
 * call (e.g. during a login-brute-force or join-code-brute-force run) to
 * dodge the limiter entirely. Only honor it when it resolves to a
 * participant that actually exists, otherwise fall back to IP.
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

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const participantId = req.headers?.["x-participant-id"];
    if (typeof participantId === "string" && participantId.trim()) {
      const id = participantId.trim();
      if (await this.participantExists(id)) {
        return `participant:${id}`;
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
