import { NestFactory } from '@nestjs/core';
import { TrendAppModule } from './trend-app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(TrendAppModule);
  const configService = app.get(ConfigService);
  const port = configService.get<number>('TREND_PORT', 3002);
  await app.listen(port);
  console.log(`Trend service is running on port ${port}`);
}
bootstrap();


