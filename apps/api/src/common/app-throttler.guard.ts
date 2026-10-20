import { Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModuleOptions, ThrottlerStorage, getOptionsToken, getStorageToken } from "@nestjs/throttler";
import { SESSION_COOKIE_NAME } from "./auth.constants.js";
import { getCookieValue } from "./cookie.utils.js";
import { AuthService } from "../modules/services/auth.service.js";

/**
 * Default ThrottlerGuard keys every bucket by source IP. That pools every
 * child/trainer behind the same NAT (a classroom network) into one counter,
 * so a handful of kids playing concurrently trips false 429s. Key by
 * participant/session identity instead, when we have one, and only fall
 * back to IP for pre-auth requests (login, join) where no identity exists yet.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  constructor(
    @Inject(getOptionsToken()) options: ThrottlerModuleOptions,
    @Inject(getStorageToken()) storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly authService: AuthService
  ) {
    super(options, storageService, reflector);
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const participantId = req.headers?.["x-participant-id"];
    if (typeof participantId === "string" && participantId.trim()) {
      return `participant:${participantId.trim()}`;
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
}
