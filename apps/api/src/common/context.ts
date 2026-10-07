import { AsyncLocalStorage } from 'node:async_hooks';
import type { Role } from '../db';

export interface Principal {
  kind: 'USER';
  userId: string;
  organizationId: string;
  roles: Role[];
  name: string;
  email: string;
}

export interface CandidatePrincipal {
  kind: 'CANDIDATE';
  interviewId: string;
  organizationId: string;
}

export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
  principal?: Principal | CandidatePrincipal;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();
export const currentContext = (): RequestContext | undefined => requestContext.getStore();
