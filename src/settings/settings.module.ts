import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Plan } from './plan.entity';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { Subscription } from './subscription.entity';
import { SystemSetting } from './system-setting.entity';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([SystemSetting, Plan, Subscription])],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
