import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { AppModule } from '../src/app.module';

const server = express();
let isReady = false;

async function bootstrap() {
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server));
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });
  await app.init();
  isReady = true;
}

const appPromise = bootstrap();

export default async function handler(req: any, res: any) {
  await appPromise;
  if (!isReady) {
    res.status(503).send('Server is starting up...');
    return;
  }
  server(req, res);
}
