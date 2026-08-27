import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

@Injectable()
export class MailboxScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const principal = request.principal;

    if (principal === undefined) {
      throw new UnauthorizedException();
    }

    if (principal.kind !== 'mailbox') {
      return true;
    }

    const requested = (request.params as Record<string, string | undefined>)['mailboxId'];

    if (requested !== undefined && requested !== principal.mailboxId) {
      throw new NotFoundException('No such mailbox');
    }

    return true;
  }
}
