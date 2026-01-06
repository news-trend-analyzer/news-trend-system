import { NestFactory } from '@nestjs/core';
import { CollectorAppModule } from './collector-app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(CollectorAppModule);
  const configService = app.get(ConfigService);
  const port = configService.get<number>('COLLECTOR_PORT', 3001);
  await app.listen(port);
  console.log(`Collector service is running on port ${port}`);
}
bootstrap();


