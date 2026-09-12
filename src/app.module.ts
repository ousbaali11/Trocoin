import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppThrottlerGuard } from './common/guards/app-throttler.guard';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminModule } from './admin/admin.module';
import { HealthController } from './health/health.controller';
import { AuthModule } from './auth/auth.module';
import { CategoriesModule } from './categories/categories.module';
import { validateEnv } from './config/env.validation';
import { ConversationsModule } from './conversations/conversations.module';
import { buildDataSourceOptions } from './data-source';
import { DevModule } from './dev/dev.module';
import { FavoritesModule } from './favorites/favorites.module';
import { ListingsModule } from './listings/listings.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OtpModule } from './otp/otp.module';
import { PaymentsModule } from './payments/payments.module';
import { ReportsModule } from './reports/reports.module';
import { ReviewsModule } from './reviews/reviews.module';
import { SavedSearchesModule } from './saved-searches/saved-searches.module';
import { SettingsModule } from './settings/settings.module';
import { PagesModule } from './pages/pages.module';
import { ShopsModule } from './shops/shops.module';
import { SmsModule } from './sms/sms.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          name: 'default',
          ttl: 60_000,
          // Surchargeable (tests) ; 100 req/min/IP par défaut
          limit: Number(config.get('THROTTLE_LIMIT') || 100),
        },
      ],
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        ...buildDataSourceOptions(process.env),
        // Les entités sont chargées par les modules (forFeature) ; le glob
        // de data-source.ts sert uniquement à la CLI de migrations.
        entities: undefined,
        autoLoadEntities: true,
      }),
    }),
    SettingsModule,
    SmsModule,
    OtpModule,
    UsersModule,
    PagesModule,
    ShopsModule,
    AuthModule,
    CategoriesModule,
    ListingsModule,
    FavoritesModule,
    ConversationsModule,
    PaymentsModule,
    ReviewsModule,
    ReportsModule,
    NotificationsModule,
    SavedSearchesModule,
    AdminModule,
    DevModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: AppThrottlerGuard }],
})
export class AppModule {}
