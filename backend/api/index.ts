import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';

let cachedApp: any;

export default async function handler(req: any, res: any) {
  try {
    if (!cachedApp) {
      const app = await NestFactory.create(AppModule, {
        logger: ['error', 'warn'],
      });
      app.enableCors({
        origin: true,
        methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
        credentials: true,
      });
      await app.init();
      cachedApp = app.getHttpAdapter().getInstance();
    }
    return cachedApp(req, res);
  } catch (error: any) {
    console.error('❌ NestJS bootstrap failed:', error);
    return res.status(500).json({
      error: 'Backend failed to start',
      message: error.message,
      hint: 'Check that DATABASE_URL is correctly set in Vercel Environment Variables',
    });
  }
}
