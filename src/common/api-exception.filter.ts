import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';

import { recordFailure } from '../logging';
import type { ApiError } from './api-error';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();

    const status: HttpStatus =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = this.messageOf(exception, status);

    recordFailure(response, status, exception, message);

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
}

function errorLabel(status: number): string {
  return (HttpStatus as unknown as Record<number, string | undefined>)[status] ?? 'ERROR';
}
