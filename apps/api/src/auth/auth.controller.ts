import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import {
  changePasswordRequest,
  createOrganizationRequest,
  emailRequest,
  loginRequest,
  mfaDisableRequest,
  mfaEnableRequest,
  mfaVerifyRequest,
  resetPasswordRequest,
  signupRequest,
  switchOrganizationRequest,
  tokenRequest,
  type LoginResponse,
  type SignupRequest,
} from '@omnitrack/contracts';
import type { Response } from 'express';
import { z } from 'zod';
import type { AppRequest, RequestContext } from '../common/context';
import { randomToken } from '../common/crypto';
import {
  AllowMfaPending,
  AllowWithoutMfaEnrollment,
  Authenticated,
  Ctx,
  Public,
} from '../common/decorators';
import { UuidParam, ZodPipe } from '../common/zod.pipe';
import { AuthService } from './auth.service';
import { MeService } from './me.service';
import { CSRF_COOKIE, SessionService } from './session.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  /** Issues the double-submit CSRF token (cookie + body). Call before the first POST. */
  @Get('csrf')
  @Public()
  csrf(@Req() req: AppRequest & { cookies?: Record<string, string> }, @Res({ passthrough: true }) res: Response) {
    const existing = req.cookies?.[CSRF_COOKIE];
    const token = existing && existing.length >= 20 ? existing : randomToken();
    this.sessions.setCsrfCookie(res, token);
    return { csrfToken: token };
  }

  @Post('signup')
  @Public()
  @HttpCode(202)
  async signup(@Ctx() ctx: RequestContext, @Body(new ZodPipe(signupRequest)) body: SignupRequest) {
    await this.auth.signup(ctx, body);
    return { message: 'Check your email to verify your address and finish signing up.' };
  }

  @Post('email/verify')
  @Public()
  @HttpCode(200)
  async verifyEmail(@Ctx() ctx: RequestContext, @Body(new ZodPipe(tokenRequest)) body: { token: string }) {
    await this.auth.verifyEmail(ctx, body.token);
    return { message: 'Email verified. You can now sign in.' };
  }

  @Post('email/resend')
  @Public()
  @HttpCode(202)
  async resend(@Ctx() ctx: RequestContext, @Body(new ZodPipe(emailRequest)) body: { email: string }) {
    await this.auth.resendVerification(ctx, body.email);
    return { message: 'If that address is waiting for verification, a new link is on its way.' };
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  login(
    @Ctx() ctx: RequestContext,
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodPipe(loginRequest)) body: z.infer<typeof loginRequest>,
  ): Promise<LoginResponse> {
    return this.auth.login(ctx, res, body);
  }

  @Post('mfa/verify')
  @Authenticated({ requireOrganization: false })
  @AllowMfaPending()
  @AllowWithoutMfaEnrollment()
  @HttpCode(200)
  verifyMfa(
    @Ctx() ctx: RequestContext,
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodPipe(mfaVerifyRequest)) body: { code: string },
  ): Promise<LoginResponse> {
    return this.auth.verifyMfa(ctx, res, body.code);
  }

  @Post('logout')
  @Authenticated({ requireOrganization: false })
  @AllowMfaPending()
  @AllowWithoutMfaEnrollment()
  @HttpCode(204)
  async logout(@Ctx() ctx: RequestContext, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(ctx, res);
  }

  @Post('password/forgot')
  @Public()
  @HttpCode(202)
  async forgot(@Ctx() ctx: RequestContext, @Body(new ZodPipe(emailRequest)) body: { email: string }) {
    await this.auth.forgotPassword(ctx, body.email);
    return { message: 'If an account exists for that address, a reset link is on its way.' };
  }

  @Post('password/reset')
  @Public()
  @HttpCode(200)
  async reset(@Ctx() ctx: RequestContext, @Body(new ZodPipe(resetPasswordRequest)) body: { token: string; password: string }) {
    await this.auth.resetPassword(ctx, body.token, body.password);
    return { message: 'Password changed. Sign in with your new password.' };
  }

  @Post('switch-organization')
  @Authenticated({ requireOrganization: false })
  @AllowWithoutMfaEnrollment()
  @HttpCode(204)
  async switchOrganization(
    @Ctx() ctx: RequestContext,
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodPipe(switchOrganizationRequest)) body: { organizationId: string },
  ) {
    await this.auth.switchOrganization(ctx, res, body.organizationId);
  }
}

@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get()
  @Authenticated({ requireOrganization: false })
  @AllowWithoutMfaEnrollment()
  get(@Ctx() ctx: RequestContext) {
    return this.me.me(ctx.principal!);
  }

  @Get('sessions')
  @Authenticated({ requireOrganization: false })
  @AllowWithoutMfaEnrollment()
  sessions(@Ctx() ctx: RequestContext) {
    return this.me.sessionsOf(ctx.principal!);
  }

  @Delete('sessions/:id')
  @Authenticated({ requireOrganization: false })
  @AllowWithoutMfaEnrollment()
  @HttpCode(204)
  async revoke(@Ctx() ctx: RequestContext, @Param('id', UuidParam) id: string) {
    await this.me.revokeSession(ctx, id);
  }

  @Post('sessions/revoke-others')
  @Authenticated({ requireOrganization: false })
  @AllowWithoutMfaEnrollment()
  async revokeOthers(@Ctx() ctx: RequestContext) {
    return { revoked: await this.me.revokeOtherSessions(ctx) };
  }

  @Get('login-history')
  @Authenticated({ requireOrganization: false })
  @AllowWithoutMfaEnrollment()
  history(@Ctx() ctx: RequestContext) {
    return this.me.loginHistory(ctx.principal!);
  }

  @Post('password')
  @Authenticated({ requireOrganization: false })
  @AllowWithoutMfaEnrollment()
  @HttpCode(204)
  async changePassword(
    @Ctx() ctx: RequestContext,
    @Body(new ZodPipe(changePasswordRequest)) body: { currentPassword: string; newPassword: string },
  ) {
    await this.me.changePassword(ctx, body.currentPassword, body.newPassword);
  }

  @Post('mfa/totp/setup')
  @Authenticated({ requireOrganization: false })
  @AllowWithoutMfaEnrollment()
  setupMfa(@Ctx() ctx: RequestContext) {
    return this.me.startMfaSetup(ctx.principal!);
  }

  @Post('mfa/totp/enable')
  @Authenticated({ requireOrganization: false })
  @AllowWithoutMfaEnrollment()
  enableMfa(@Ctx() ctx: RequestContext, @Body(new ZodPipe(mfaEnableRequest)) body: { code: string }) {
    return this.me.enableMfa(ctx, body.code);
  }

  @Post('mfa/totp/disable')
  @Authenticated({ requireOrganization: false })
  @HttpCode(204)
  async disableMfa(@Ctx() ctx: RequestContext, @Body(new ZodPipe(mfaDisableRequest)) body: { password: string; code: string }) {
    await this.me.disableMfa(ctx, body.password, body.code);
  }
}

@Controller('organizations')
export class OrganizationsCreateController {
  constructor(private readonly auth: AuthService) {}

  /** Create an additional organization; the caller becomes its owner. Switch to it afterwards. */
  @Post()
  @Authenticated({ requireOrganization: false })
  createOrganization(
    @Ctx() ctx: RequestContext,
    @Body(new ZodPipe(createOrganizationRequest)) body: { name: string; slug: string },
  ) {
    return this.auth.createOrganization(ctx, body);
  }
}
