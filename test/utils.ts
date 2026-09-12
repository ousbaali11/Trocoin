import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { SmsService } from '../src/sms/sms.service';
import { User } from '../src/users/user.entity';

export interface TestUser {
  id: string;
  phone: string;
  token: string;
  auth: { Authorization: string };
}

let counter = 0;
/** Numéro français unique par appel (06 90 00 xx xx). */
export function nextPhone(): string {
  counter += 1;
  return '+33690' + String(counter).padStart(6, '0');
}

export async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    cors: {
      origin: (origin, cb) => {
        if (!origin || origin === 'http://localhost:3001') return cb(null, true);
        return cb(new Error(`Origine non autorisée par CORS : ${origin}`), false);
      },
      credentials: true,
    },
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}

/** Inscription + OTP complet, renvoie un utilisateur connecté. */
export async function login(app: INestApplication, phone = nextPhone()): Promise<TestUser> {
  const server = app.getHttpServer();
  await request(server).post('/auth/register/phone').send({ phoneNumber: phone }).expect(200);
  const code = app.get(SmsService).getLastCodeForDev(phone);
  if (!code) throw new Error('OTP introuvable pour ' + phone);
  const res = await request(server).post('/auth/otp/verify').send({ phoneNumber: phone, code }).expect(200);
  return { id: res.body.user.id, phone, token: res.body.accessToken, auth: { Authorization: `Bearer ${res.body.accessToken}` } };
}

/** Promotion admin directe en base (équivalent du script CLI create-admin). */
export async function makeAdmin(app: INestApplication, user: TestUser): Promise<void> {
  const repo = app.get<Repository<User>>(getRepositoryToken(User));
  await repo.update(user.id, { accountType: 'admin' });
}

export async function createListing(
  app: INestApplication,
  user: TestUser,
  overrides: Record<string, unknown> = {},
) {
  const res = await request(app.getHttpServer())
    .post('/listings')
    .set(user.auth)
    .send({
      title: 'Canapé trois places en velours vert',
      description: 'Très bon état, peu servi, à venir chercher sur place.',
      categorySlug: 'ameublement',
      price: 250,
      priceType: 'fixe',
      condition: 'tres_bon_etat',
      city: 'Lyon',
      postalCode: '69003',
      deliveryAvailable: true,
      ...overrides,
    });
  if (res.status !== 201) throw new Error(`createListing: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

/** PNG 1x1 valide (signature réelle). */
export const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
