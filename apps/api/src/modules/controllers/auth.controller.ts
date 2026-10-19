import { Body, Controller, Delete, Get, Headers, Param, Post, Req, Res, UnauthorizedException } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { SESSION_COOKIE_NAME } from "../../common/auth.constants.js";
import { assertTrustedOrigin, getSessionCookieOptions } from "../../common/auth-security.js";
import type { AuthRequest } from "../../common/auth.types.js";
import { getCookieValue } from "../../common/cookie.utils.js";
import { AcceptInviteDtoClass, ChangePasswordDtoClass, LoginDtoClass, SwitchOrganizationDtoClass } from "../dto/auth.dto.js";
import { AuditLogService } from "../services/audit-log.service.js";
import { AuthService } from "../services/auth.service.js";
@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly auditLog: AuditLogService
  ) {}

  @Post("login")
  @Throttle({ default: { limit: 6, ttl: 60_000, blockDuration: 120_000 } })
  async login(
    @Body() body: LoginDtoClass,
    @Req() request: AuthRequest,
    @Headers() headers: Record<string, string | undefined>,
    @Res({ passthrough: true }) response: {
      cookie: (name: string, value: string, options: Record<string, unknown>) => void;
    }
  ) {
    assertTrustedOrigin({
      ...request,
      headers
    });

    try {
      const session = await this.authService.createSession(body.email, body.password, {
        ipAddress: headers["x-forwarded-for"],
        userAgent: headers["user-agent"]
      });

      response.cookie(SESSION_COOKIE_NAME, session.token, {
        ...getSessionCookieOptions(new Date(session.expiresAt))
      });

      await this.auditLog.log({
        action: "auth.login",
        ...this.auditLog.actorFromRequest({
          ...request,
          user: session.user,
          headers
        }),
        targetType: "user_session",
        targetId: session.user.id,
        metadata: {
          email: body.email
        }
      });

      return {
        data: {
          user: session.user,
          expiresAt: session.expiresAt
        }
      };
    } catch (error) {
      await this.auditLog.log({
        action: "auth.login",
        status: "failure",
        ...this.auditLog.actorFromRequest({
          ...request,
          headers
        }),
        targetType: "user",
        metadata: {
          email: body.email,
          reason: error instanceof Error ? error.message : "unknown"
        }
      });

      throw error;
    }
  }

  @Post("logout")
  async logout(
    @Req() request: AuthRequest,
    @Headers() headers: Record<string, string | undefined>,
    @Res({ passthrough: true }) response: {
      clearCookie: (name: string, options: Record<string, unknown>) => void;
    }
  ) {
    assertTrustedOrigin({
      ...request,
      headers
    });

    const token = getCookieValue(headers.cookie, SESSION_COOKIE_NAME);
    const session = token ? await this.authService.getSessionByToken(token) : null;
    if (token) {
      await this.authService.revokeSession(token);
    }

    response.clearCookie(SESSION_COOKIE_NAME, {
      ...getSessionCookieOptions(new Date())
    });

    await this.auditLog.log({
      action: "auth.logout",
      ...(session
        ? this.auditLog.actorFromRequest({
            ...request,
            user: session.user,
            headers
          })
        : this.auditLog.actorFromRequest({
            ...request,
            headers
          })),
      targetType: "user_session",
      targetId: session?.id
    });

    return { data: { ok: true } };
  }

  @Get("me")
  async me(@Headers() headers: Record<string, string | undefined>) {
    const token = getCookieValue(headers.cookie, SESSION_COOKIE_NAME);
    if (!token) {
      throw new UnauthorizedException("No active session");
    }

    const session = await this.authService.requireSession(token);
    return {
      data: {
        user: session.user,
        expiresAt: session.expiresAt
      }
    };
  }

  @Get("invites/:token")
  async getInvitePreview(@Param("token") token: string) {
    return {
      data: await this.authService.getInvitePreview(token)
    };
  }

  @Post("switch-organization")
  async switchOrganization(
    @Req() request: AuthRequest,
    @Headers() headers: Record<string, string | undefined>,
    @Body() body: SwitchOrganizationDtoClass
  ) {
    assertTrustedOrigin({
      ...request,
      headers
    });

    const token = getCookieValue(headers.cookie, SESSION_COOKIE_NAME);
    if (!token) {
      throw new UnauthorizedException("No active session");
    }

    const session = await this.authService.requireSession(token);
    const updated = await this.authService.switchOrganization(token, session.user.id, body.organizationId);

    await this.auditLog.log({
      action: "auth.switch_organization",
      ...this.auditLog.actorFromRequest({
        ...request,
        headers,
        user: updated.user
      }),
      targetType: "organization",
      targetId: body.organizationId
    });

    return {
      data: {
        user: updated.user,
        expiresAt: updated.expiresAt
      }
    };
  }

  @Get("sessions")
  async sessions(@Headers() headers: Record<string, string | undefined>) {
    const token = getCookieValue(headers.cookie, SESSION_COOKIE_NAME);
    if (!token) {
      throw new UnauthorizedException("No active session");
    }

    const session = await this.authService.requireSession(token);
    return {
      data: await this.authService.listSessionsForUser(session.user.id, token)
    };
  }

  @Post("logout-all")
  async logoutAll(
    @Req() request: AuthRequest,
    @Headers() headers: Record<string, string | undefined>,
    @Res({ passthrough: true }) response: {
      clearCookie: (name: string, options: Record<string, unknown>) => void;
    }
  ) {
    assertTrustedOrigin({
      ...request,
      headers
    });

    const token = getCookieValue(headers.cookie, SESSION_COOKIE_NAME);
    if (!token) {
      throw new UnauthorizedException("No active session");
    }

    const session = await this.authService.requireSession(token);
    await this.authService.revokeAllSessionsForUser(session.user.id);
    response.clearCookie(SESSION_COOKIE_NAME, getSessionCookieOptions(new Date()));

    await this.auditLog.log({
      action: "auth.logout_all",
      ...this.auditLog.actorFromRequest({
        ...request,
        headers,
        user: session.user
      }),
      targetType: "user",
      targetId: session.user.id
    });

    return { data: { ok: true } };
  }

  @Delete("sessions/:id")
  async revokeSession(
    @Req() request: AuthRequest,
    @Headers() headers: Record<string, string | undefined>,
    @Param("id") sessionId: string
  ) {
    assertTrustedOrigin({
      ...request,
      headers
    });

    const token = getCookieValue(headers.cookie, SESSION_COOKIE_NAME);
    if (!token) {
      throw new UnauthorizedException("No active session");
    }

    const session = await this.authService.requireSession(token);
    const result = await this.authService.revokeSessionById(session.user.id, sessionId, token);

    await this.auditLog.log({
      action: "auth.revoke_session",
      ...this.auditLog.actorFromRequest({
        ...request,
        headers,
        user: session.user
      }),
      targetType: "user_session",
      targetId: sessionId
    });

    return { data: result };
  }

  @Post("change-password")
  async changePassword(
    @Req() request: AuthRequest,
    @Headers() headers: Record<string, string | undefined>,
    @Body() body: ChangePasswordDtoClass,
    @Res({ passthrough: true }) response: {
      clearCookie: (name: string, options: Record<string, unknown>) => void;
    }
  ) {
    assertTrustedOrigin({
      ...request,
      headers
    });

    const token = getCookieValue(headers.cookie, SESSION_COOKIE_NAME);
    if (!token) {
      throw new UnauthorizedException("No active session");
    }

    const session = await this.authService.requireSession(token);
    const result = await this.authService.changePassword(session.user.id, {
      currentPassword: body.currentPassword,
      nextPassword: body.nextPassword
    });
    response.clearCookie(SESSION_COOKIE_NAME, getSessionCookieOptions(new Date()));

    await this.auditLog.log({
      action: "auth.change_password",
      ...this.auditLog.actorFromRequest({
        ...request,
        headers,
        user: session.user
      }),
      targetType: "user",
      targetId: session.user.id
    });

    return { data: result };
  }

  @Post("accept-invite")
  async acceptInvite(@Req() request: AuthRequest, @Body() body: AcceptInviteDtoClass) {
    const user = await this.authService.acceptInvite(body);

    await this.auditLog.log({
      action: "auth.accept_invite",
      ...this.auditLog.actorFromRequest({
        ...request,
        user
      }),
      targetType: "user",
      targetId: user.id,
      metadata: {
        email: user.email
      }
    });

    return { data: user };
  }

  @Post("support/login-as/:userId")
  async loginAsSupportUser(
    @Req() request: AuthRequest,
    @Headers() headers: Record<string, string | undefined>,
    @Param("userId") userId: string,
    @Res({ passthrough: true }) response: {
      cookie: (name: string, value: string, options: Record<string, unknown>) => void;
    }
  ) {
    assertTrustedOrigin({
      ...request,
      headers
    });

    const token = getCookieValue(headers.cookie, SESSION_COOKIE_NAME);
    if (!token) {
      throw new UnauthorizedException("No active session");
    }

    const session = await this.authService.requireSession(token);
    if (session.user.role !== "admin") {
      throw new UnauthorizedException("Only admins can enter support mode");
    }

    const supportSession = await this.authService.createSupportSession(session.user.id, userId, {
      ipAddress: headers["x-forwarded-for"],
      userAgent: headers["user-agent"]
    });

    response.cookie(SESSION_COOKIE_NAME, supportSession.token, {
      ...getSessionCookieOptions(new Date(supportSession.expiresAt))
    });

    await this.auditLog.log({
      action: "auth.support.login_as",
      ...this.auditLog.actorFromRequest({
        ...request,
        user: session.user,
        headers
      }),
      targetType: "user",
      targetId: userId
    });

    return {
      data: {
        user: supportSession.user,
        expiresAt: supportSession.expiresAt
      }
    };
  }

  @Post("support/exit")
  async exitSupportMode(
    @Req() request: AuthRequest,
    @Headers() headers: Record<string, string | undefined>,
    @Res({ passthrough: true }) response: {
      cookie: (name: string, value: string, options: Record<string, unknown>) => void;
    }
  ) {
    assertTrustedOrigin({
      ...request,
      headers
    });

    const token = getCookieValue(headers.cookie, SESSION_COOKIE_NAME);
    if (!token) {
      throw new UnauthorizedException("No active session");
    }

    const currentSession = await this.authService.requireSession(token);
    const restored = await this.authService.endSupportSession(token);

    response.cookie(SESSION_COOKIE_NAME, restored.token, {
      ...getSessionCookieOptions(new Date(restored.expiresAt))
    });

    await this.auditLog.log({
      action: "auth.support.exit",
      ...this.auditLog.actorFromRequest({
        ...request,
        user: restored.user,
        headers
      }),
      targetType: "user",
      targetId: currentSession.user.id
    });

    return {
      data: {
        user: restored.user,
        expiresAt: restored.expiresAt
      }
    };
  }
}
