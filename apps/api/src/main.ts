import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, HttpException, HttpStatus } from '@nestjs/common';
import * as session from 'express-session';
import * as cookieParser from 'cookie-parser';
import { AppConfigService, preloadRestartSettingsIntoEnv } from '@versigo/foundation';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // AP-17: restart settings (category "restart") before the Nest bootstrap
  // load from the database into process.env so that from the first
  // take effect at the next process start (fail-soft when the DB is unreachable).
  await preloadRestartSettingsIntoEnv();

  const app = await NestFactory.create(AppModule);
  const config = app.get(AppConfigService);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      // BugFix-02: return structured validation errors
      // So the frontend can display field-specific error messages
      exceptionFactory: (errors) => {
        const fieldErrors = errors.flatMap((error) => {
          const field = error.property;
          if (error.constraints) {
            return Object.entries(error.constraints).map(([constraint, message]) => ({
              field,
              constraint,
              message,
            }));
          }
          if (error.children && error.children.length > 0) {
            return error.children.flatMap((child) => {
              const childField = child.property;
              if (child.constraints) {
                return Object.entries(child.constraints).map(([constraint, message]) => ({
                  field: childField,
                  constraint,
                  message,
                }));
              }
              return [];
            });
          }
          return [];
        });
        return new HttpException(
          {
            message: 'Validation failed',
            errors: fieldErrors,
            statusCode: 400,
          },
          HttpStatus.BAD_REQUEST,
        );
      },
    }),
  );

  // AP-16/ADR-007: only enable behind a trusted reverse proxy.
  // Without trust proxy, req.ip behind a proxy falls back to the proxy IP,
  // which would make the per-IP rate limits (login/registration) block
  // all clients globally. Default false = direct connection, the proxy IP
  // is
  // Client-IP.
  app.getHttpAdapter().getInstance().set('trust proxy', config.get('TRUST_PROXY'));

  // AP-16: the web app (e.g. http://localhost:3000) calls the API
  // cross-origin with credentials:'include' (login/registration, /auth/me,
  // admin UI). CORS is therefore restricted to the configured web origins
  // (CORS_ORIGINS, comma-separated) and allows cookies (credentials: true).
  // Without this header the browser blocks reading all API responses.
  //
  // AP-17/BugFix-02: in development (NODE_ENV !== 'production') we allow
  // additionally every localhost origin (any port), so that non-standard
  // ports (e.g. 2478/2479 in test environments) work without a manual
  // CORS_ORIGINS adjustment. In production only the configured CORS_ORIGINS
  // list applies.
  const corsOrigins = config.get('CORS_ORIGINS');
  const isDevelopment = config.get('NODE_ENV') !== 'production';
  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) {
        // Same-origin or non-browser requests (e.g. curl, server-to-server)
        return callback(null, true);
      }
      if (corsOrigins.includes(origin)) {
        return callback(null, true);
      }
      if (isDevelopment && /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
        // Allow any localhost port in development
        return callback(null, true);
      }
      callback(new Error(`CORS: Origin ${origin} not allowed`), false);
    },
    credentials: true,
  });

  app.use(cookieParser());
  app.use(
    session({
      name: 'versigo.sid',
      secret: config.get('SESSION_SECRET'),
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: config.get('COOKIE_SECURE'),
        sameSite: 'lax',
        // BugFix-02: in development, set the cookie domain to 'localhost' (without port)
        // so the session cookie works across different localhost ports (e.g., web on 2478, API on 2479).
        // This makes the cookie a domain cookie for 'localhost' instead of a host-only cookie
        // that includes the port. In production, leave undefined to use the default host-only behavior.
        domain: config.get('NODE_ENV') !== 'production' ? 'localhost' : undefined,
        maxAge: 1000 * 60 * 60 * 8,
      },
    }),
  );

  app.enableShutdownHooks();

  await app.listen(config.get('APP_PORT'));
}

void bootstrap();
