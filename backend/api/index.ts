import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { AppModule } from '../src/app.module';

const server = express();
let bootstrapError: Error | null = null;
let isReady = false;

const appPromise = (async () => {
  try {
    const app = await NestFactory.create(AppModule, new ExpressAdapter(server), {
      logger: ['error', 'warn'],
    });
    app.enableCors({
      origin: '*',
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
      credentials: true,
    });
    await app.init();
    isReady = true;
    console.log('✅ NestJS bootstrap complete');
  } catch (err: any) {
    bootstrapError = err;
    console.error('❌ NestJS bootstrap failed:', err.message);
  }
})();

export default async function handler(req: any, res: any) {
  await appPromise;

  if (bootstrapError) {
    return res.status(500).json({
      error: 'Backend failed to start',
      message: bootstrapError.message,
      hint: 'Check that DATABASE_URL is correctly set in Vercel Environment Variables',
    });
  }

  if (!isReady) {
    return res.status(503).json({ error: 'Server is still starting up' });
  }

  return server(req, res);
}
