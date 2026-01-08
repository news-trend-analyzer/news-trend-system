import { Module } from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { TrendModule } from './trend.module';
import { ConfigModule } from '../common/config/config.module';
import { ConfigService } from '@nestjs/config';
import { HealthController } from './health.controller';

/**
 * Trend 서비스 전용 AppModule
 * Trend와 관련된 모듈만 포함
 */
@Module({
  imports: [
    ConfigModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
       useFactory: (configService: ConfigService) => {
        return [
          {
            ttl: configService.get<number>('THROTTLE_TTL', 60) * 1000,
            limit: configService.get<number>('THROTTLE_LIMIT', 100),
          },
        ];
      },
    }),
    TrendModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class TrendAppModule {}


