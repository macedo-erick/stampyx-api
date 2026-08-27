import { Injectable, Logger } from '@nestjs/common';
import {
  type OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

import { JwtGuard } from '../auth/jwt.guard';
import type { Principal } from '../auth/principal';
import { PrincipalResolver } from '../auth/principal.resolver';

export interface MailReceivedEvent {
  readonly id: string;
  readonly mailboxId: string;
  readonly messageId: string;
  readonly sender: string;
  readonly subject: string | null;
  readonly folder: string;
  readonly receivedAt: string;
}

export function inboxRoom(mailboxId: string): string {
  return `inbox:${mailboxId}`;
}

@Injectable()
@WebSocketGateway({ path: '/api/socket.io', cors: { origin: false } })
export class MailGateway implements OnGatewayConnection {
  private readonly logger = new Logger(MailGateway.name);

  @WebSocketServer()
  private server?: Server;

  constructor(
    private readonly jwt: JwtGuard,
    private readonly resolver: PrincipalResolver,
  ) {}

  // Guards do not run on socket events, so the handshake is the only place to identify the caller.
  async handleConnection(client: Socket): Promise<void> {
    const token = tokenOf(client);

    if (token === null) {
      client.disconnect(true);

      return;
    }

    try {
      const principal = await this.resolver.resolve(await this.jwt.identify(token));

      (client.data as Record<string, unknown>)['principal'] = principal;
    } catch {
      this.logger.warn(`socket ${client.id} presented a token it could not be identified by`);
      client.disconnect(true);
    }
  }

  // The same ownership rules the HTTP routes use; without it any socket reads every subject line.
  @SubscribeMessage('inbox:join')
  async join(client: Socket, mailboxId: unknown): Promise<void> {
    const principal = principalOf(client);

    if (principal === null || typeof mailboxId !== 'string' || mailboxId === '') {
      return;
    }

    if (!(await this.resolver.mayRead(principal, mailboxId))) {
      this.logger.warn({ event: 'socket.join_refused', mailboxId });

      return;
    }

    await client.join(inboxRoom(mailboxId));
  }

  @SubscribeMessage('inbox:leave')
  async leave(client: Socket, mailboxId: unknown): Promise<void> {
    if (typeof mailboxId === 'string' && mailboxId !== '') {
      await client.leave(inboxRoom(mailboxId));
    }
  }

  emitReceived(event: MailReceivedEvent): void {
    this.server?.to(inboxRoom(event.mailboxId)).emit('mail:received', event);
  }
}

function tokenOf(client: Socket): string | null {
  const fromAuth = (client.handshake.auth as Record<string, unknown>)['token'];

  if (typeof fromAuth === 'string' && fromAuth !== '') {
    return fromAuth;
  }

  const fromQuery = client.handshake.query['token'];

  return typeof fromQuery === 'string' && fromQuery !== '' ? fromQuery : null;
}

function principalOf(client: Socket): Principal | null {
  const principal = (client.data as Record<string, unknown>)['principal'];

  return principal === undefined ? null : (principal as Principal);
}
