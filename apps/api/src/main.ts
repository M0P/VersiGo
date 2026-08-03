import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, HttpException, HttpStatus } from '@nestjs/common';
import * as session from 'express-session';
import * as cookieParser from 'cookie-parser';
import { AppConfigService, preloadRestartSettingsIntoEnv } from '@versigo/foundation';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // AP-17: Neustart-Settings (Kategorie "restart") vor dem Nest-Bootstrap
  // aus der Datenbank in process.env laden, damit sie ab dem ersten
  // Prozessstart wirken (fail-soft bei nicht erreichbarer DB).
  await preloadRestartSettingsIntoEnv();

  const app = await NestFactory.create(AppModule);
  const config = app.get(AppConfigService);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      // BugFix-02: Strukturierte Validierungsfehler zurückgeben
      // Damit das Frontend feldspezifische Fehlermeldungen anzeigen kann
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
            message: 'Validierung fehlgeschlagen',
            errors: fieldErrors,
            statusCode: 400,
          },
          HttpStatus.BAD_REQUEST,
        );
      },
    }),
  );

  // AP-16/ADR-007: Nur hinter einem vertrauenswuerdigen Reverse-Proxy aktivieren.
  // Ohne trust proxy faellt req.ip hinter einem Proxy auf die Proxy-IP zurueck,
  // wodurch die per-IP-Rate-Limits (Login/Registrierung) alle Clients global
  // sperren wuerden. Default false = direkte Verbindung, Proxy-IP ist die
  // Client-IP.
  app.getHttpAdapter().getInstance().set('trust proxy', config.get('TRUST_PROXY'));

  // AP-16: Die Web-App (z.B. http://localhost:3000) ruft die API cross-origin
  // mit credentials:'include' auf (Login/Registrierung, /auth/me, Admin-UI).
  // CORS ist daher auf die konfigurierten Web-Origins beschraenkt
  // (CORS_ORIGINS, Komma-separiert) und erlaubt Cookies (credentials: true).
  // Ohne diesen Header blockiert der Browser das Lesen aller API-Antworten.
  //
  // AP-17/BugFix-02: In Entwicklung (NODE_ENV !== 'production') erlauben wir
  // zusaetzlich jeden localhost-Origin (beliebiger Port), damit nicht-standardmaessige
  // Ports (z. B. 2478/2479 in Testumgebungen) ohne manuelle CORS_ORIGINS-Anpassung
  // funktionieren. In Produktion gilt strikt die konfigurierte CORS_ORIGINS-Liste.
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
        // Erlaube jeden localhost-Port in Entwicklung
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
        // BugFix-02: In development, set cookie domain to 'localhost' (without port)
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
