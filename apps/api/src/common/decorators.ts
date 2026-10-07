import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Permission } from './permissions';
import type { Principal, CandidatePrincipal } from './context';

export const PERMS_KEY = 'evida:perms';
export const PUBLIC_KEY = 'evida:public';
export const CANDIDATE_KEY = 'evida:candidate';

/** Requires every listed permission. */
export const Requires = (...perms: Permission[]) => SetMetadata(PERMS_KEY, perms);
/** No authentication (login, register, health). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
/** Authenticated via the candidate magic-link token instead of a user session. */
export const CandidateAuth = () => SetMetadata(CANDIDATE_KEY, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): Principal => {
  return ctx.switchToHttp().getRequest().principal;
});
export const CurrentCandidate = createParamDecorator((_: unknown, ctx: ExecutionContext): CandidatePrincipal => {
  return ctx.switchToHttp().getRequest().principal;
});
