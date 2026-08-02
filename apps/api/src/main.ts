import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
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
  app.enableCors({
    origin: config.get('CORS_ORIGINS'),
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
        secure: config.isProduction,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 8,
      },
    }),
  );

  app.enableShutdownHooks();

  await app.listen(config.get('APP_PORT'));
}

void bootstrap();
