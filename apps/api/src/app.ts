import 'reflect-metadata';
import { Controller, Get, Module, ServiceUnavailableException, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ApiOkResponse, ApiProperty, DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { DataSource } from 'typeorm';
import { CONFIG, Config } from './config';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { AuthGuard } from './auth/auth.guard';
import { CoursesController } from './courses/courses.controller';
import { AdminController, AnnouncementsController } from './admin/admin.controller';
import { ErrorDto, ErrorFilter } from './errors';
import { ObjectStorage } from '@lms/media-core';
import { MediaController } from './media/media.controller';
import { MediaService, STORAGE } from './media/media.service';
import { AiController } from './ai/ai.controller';
import { AiService, AI_CONFIG } from './ai/ai.service';
import { aiConfigSchema } from '@lms/ai-core';
import { LearningController } from './learning/learning.controller';
import { LearningService } from './learning/learning.service';

class HealthDto { @ApiProperty({ enum: ['ok'] }) status!: string; }
@Controller('health')
class HealthController {
  constructor(private readonly db: DataSource) {}
  @Get() @ApiOkResponse({ type: HealthDto })
  async get() {
    try { await this.db.query('SELECT 1'); } catch { throw new ServiceUnavailableException('Database chưa sẵn sàng.'); }
    return { status: 'ok' };
  }
}

export async function createApp(config: Config, db: DataSource, storage: ObjectStorage | null = null) {
  @Module({ controllers: [AuthController, CoursesController, AdminController, AnnouncementsController, HealthController, MediaController, AiController, LearningController],
    providers: [AuthService, AuthGuard, MediaService, AiService, LearningService, { provide: AI_CONFIG, useValue: process.env.AI_ENABLED === 'true' ? aiConfigSchema.parse(process.env) : null }, { provide: STORAGE, useValue: storage },
      { provide: DataSource, useValue: db }, { provide: CONFIG, useValue: config }] })
  class AppModule {}
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  app.useBodyParser('json', { limit: '20mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '20mb' });
  app.setGlobalPrefix('api/v1');
  const allowedOrigins = new Set([
    config.WEB_ORIGIN,
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3001',
  ]);
  app.enableCors({
    origin: (requestOrigin, callback) => {
      if (!requestOrigin || allowedOrigins.has(requestOrigin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Protection', 'X-Request-ID'],
  });
  app.use((request: Request, response: Response, next: NextFunction) => {
    request.headers['x-request-id'] = randomUUID();
    response.setHeader('X-Request-ID', request.headers['x-request-id']);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  // Giới hạn theo IP cho một API instance; không tin X-Forwarded-For từ client.
  const limits = new Map<string, { count: number; expires: number }>();
  app.use('/api/v1/auth', (request: Request, response: Response, next: NextFunction) => {
    if (request.method !== 'POST') return next();
    const now = Date.now();
    for (const [key, value] of limits) if (value.expires < now) limits.delete(key);
    const key = request.ip ?? 'unknown';
    const entry = limits.get(key) ?? { count: 0, expires: now + 60000 };
    entry.count++; limits.set(key, entry);
    if (entry.count > 60) {
      response.setHeader('Retry-After', Math.max(1, Math.ceil((entry.expires - now) / 1000)));
      response.status(429).json({ code: 'RATE_LIMITED', message: 'Vui lòng thử lại sau.', request_id: request.headers['x-request-id'] });
      return;
    }
    next();
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true,
    transform: true, errorHttpStatusCode: 422, validationError: { target: false, value: false } }));
  app.useGlobalFilters(new ErrorFilter());
  return app;
}

export function createOpenApi(app: Awaited<ReturnType<typeof createApp>>) {
  const config = new DocumentBuilder().setTitle('Topic 16 LMS API').setVersion('0.2.0')
    .setDescription('Auth, khóa học, video, transcript, RAG local, quiz, tiến độ và analytics.')
    .addBearerAuth().build();
  const document = SwaggerModule.createDocument(app, config, { extraModels: [ErrorDto],
    operationIdFactory: (controller, method) => `${controller.replace('Controller', '')}_${method}` });
  for (const path of Object.values(document.paths)) {
    for (const operation of Object.values(path ?? {})) {
      if (!operation || typeof operation !== 'object' || !('responses' in operation)) continue;
      for (const status of [400, 401, 403, 404, 409, 413, 422, 429, 500, 503]) {
        operation.responses[status] = { description: 'Lỗi có mã và request_id.', content: {
          'application/json': { schema: { $ref: '#/components/schemas/ErrorDto' } },
        } };
      }
    }
  }
  return document;
}
