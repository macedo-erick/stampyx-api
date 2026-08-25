import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import type { Request } from 'express';

import type { Principal } from './principal';
import { PrincipalResolver } from './principal.resolver';

// Runs after JwtGuard: @UseGuards(JwtGuard, PrincipalGuard)
@Injectable()
export class PrincipalGuard implements CanActivate {
  constructor(private readonly resolver: PrincipalResolver) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const identity = request.identity;

    if (identity === undefined) {
      throw new UnauthorizedException();
    }

    request.principal = await this.resolver.resolve(identity);

    return true;
  }
}

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal => {
    const request = context.switchToHttp().getRequest<Request>();
    const principal = request.principal;

    if (principal === undefined) {
      throw new UnauthorizedException();
    }

    return principal;
  },
);

// Kept so every existing controller keeps its signature: ownership is still an accountId,
// whichever kind of principal supplied it.
export const CurrentAccount = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<Request>();
  const accountId = request.principal?.accountId;

  if (accountId === undefined) {
    throw new UnauthorizedException();
  }

  return accountId;
});
