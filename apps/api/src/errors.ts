import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Request, Response } from 'express';

export class ErrorDto {
  @ApiProperty() code!: string;
  @ApiProperty() message!: string;
  @ApiProperty({ format: 'uuid' }) request_id!: string;
  @ApiPropertyOptional({ type: [String] }) field_errors?: string[];
}
const codes: Record<number, string> = { 400: 'BAD_REQUEST', 401: 'UNAUTHENTICATED', 403: 'FORBIDDEN',
  404: 'NOT_FOUND', 409: 'CONFLICT', 413: 'PAYLOAD_TOO_LARGE', 422: 'VALIDATION_ERROR', 429: 'RATE_LIMITED', 503: 'UNAVAILABLE' };
@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const details = error instanceof HttpException ? error.getResponse() : null;
    const message = typeof details === 'object' && details && 'message' in details ? details.message : undefined;
    if (status >= 500) {
      console.error('API Error [500]:', error);
    }
    response.status(status).json({ code: codes[status] ?? 'INTERNAL_ERROR',
      message: typeof message === 'string' ? message : status === 422 ? 'Dữ liệu không hợp lệ.' : 'Không thể xử lý yêu cầu.',
      request_id: request.headers['x-request-id'], ...(Array.isArray(message) ? { field_errors: message } : {}) });
  }
}
