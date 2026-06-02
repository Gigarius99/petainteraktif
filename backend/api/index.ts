import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import * as express from 'express';

const expressApp = express();
let cachedApp = null;

async function bootstrap() {
  if (!cachedApp) {
    const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp));
    // Aktifkan CORS untuk menerima request dari Netlify
    app.enableCors({
      origin: '*', // Di production, ganti dengan URL Netlify Anda
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
      credentials: true,
    });
    await app.init();
    cachedApp = app;
  }
  return expressApp;
}

export default async function (req, res) {
  const app = await bootstrap();
  app(req, res);
}
