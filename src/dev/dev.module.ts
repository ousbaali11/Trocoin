import { Module } from '@nestjs/common';
import { SmsModule } from '../sms/sms.module';
import { DevController } from './dev.controller';

@Module({
  imports: [SmsModule],
  controllers: [DevController],
})
export class DevModule {}
