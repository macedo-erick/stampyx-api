import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import { isAdmin } from './principal';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const principal = request.principal;

    if (principal === undefined) {
      throw new UnauthorizedException();
    }

    if (!isAdmin(principal)) {
      throw new ForbiddenException('This action requires an administrator');
    }

    return true;
  }
}
