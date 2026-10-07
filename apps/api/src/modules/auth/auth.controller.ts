import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AuthService } from './auth.service';
import { clearAuthCookies, setAuthCookies } from './cookies';
import { CurrentUser, Public } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { permissionsFor } from '../../common/permissions';
import { PrismaService } from '../../common/prisma.service';
import type { Principal } from '../../common/context';

// ASVS: minimum 12 characters, no composition rules, upper bound to avoid hashing DoS.
const password = z.string().min(12, 'At least 12 characters').max(128);
const RegisterDto = z.object({
  organizationName: z.string().trim().min(2).max(120),
  name: z.string().trim().min(2).max(120),
  email: z.string().email().max(200),
  password,
  locale: z.enum(['en', 'ar']).default('en'),
});
const LoginDto = z.object({ email: z.string().email(), password: z.string().min(1).max(128), organization: z.string().max(80).optional() });
const MagicDto = z.object({ email: z.string().email() });
const ConsumeDto = z.object({ token: z.string().min(20).max(200), password: password.optional() });

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly prisma: PrismaService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  async register(@Body(new ZodPipe(RegisterDto)) dto: z.infer<typeof RegisterDto>, @Res({ passthrough: true }) res: Response) {
    const { org, tokens } = await this.auth.register(dto);
    setAuthCookies(res, tokens);
    return { organization: { id: org.id, name: org.name, slug: org.slug } };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  async login(@Body(new ZodPipe(LoginDto)) dto: z.infer<typeof LoginDto>, @Res({ passthrough: true }) res: Response) {
    setAuthCookies(res, await this.auth.login(dto.email, dto.password, dto.organization));
    return { ok: true };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('magic-link')
  magic(@Body(new ZodPipe(MagicDto)) dto: z.infer<typeof MagicDto>) {
    return this.auth.requestMagicLink(dto.email);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('magic-link/consume')
  async consume(@Body(new ZodPipe(ConsumeDto)) dto: z.infer<typeof ConsumeDto>, @Res({ passthrough: true }) res: Response) {
    setAuthCookies(res, await this.auth.consumeLoginToken(dto.token, dto.password));
    return { ok: true };
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      setAuthCookies(res, await this.auth.refresh(req.cookies?.evida_rt));
      return { ok: true };
    } catch (e) {
      clearAuthCookies(res);
      throw e;
    }
  }

  @Public()
  @HttpCode(200)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.evida_rt);
    clearAuthCookies(res);
    return { ok: true };
  }

  @Get('me')
  async me(@CurrentUser() user: Principal) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: user.organizationId },
      select: { id: true, name: true, slug: true, locale: true, blindReviewEnabled: true, recordingEnabled: true },
    });
    return { id: user.userId, name: user.name, email: user.email, roles: user.roles, permissions: [...permissionsFor(user.roles)], organization: org };
  }
}
