import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import type { ApiError } from './api-error';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();

    const status: HttpStatus =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = this.messageOf(exception, status);
    const where = `${request.method} ${request.url}`;

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(`${where} failed: ${message}`, this.stackOf(exception));
    } else if (status === HttpStatus.FORBIDDEN || status === HttpStatus.CONFLICT) {
      this.logger.warn(`${where}: ${message}`);
    } else {
      this.logger.debug(`${where}: ${message}`);
    }

    const body: ApiError = {
      timestamp: new Date().toISOString(),
      status,
      error: errorLabel(status),
      message,
    };

    response.status(status).json(body);
  }

  private messageOf(exception: unknown, status: HttpStatus): string {
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      return 'An unexpected error occurred';
    }

    if (exception instanceof HttpException) {
      const response = exception.getResponse();

      if (typeof response === 'string') {
        return response;
      }

      const detail = (response as { message?: string | string[] }).message;

      if (Array.isArray(detail)) {
        return detail.join('; ');
      }

      return detail ?? exception.message;
    }

    return 'An unexpected error occurred';
  }

  private stackOf(exception: unknown): string | undefined {
    return exception instanceof Error ? exception.stack : undefined;
  }
}

function errorLabel(status: number): string {
  return (HttpStatus as unknown as Record<number, string | undefined>)[status] ?? 'ERROR';
}
