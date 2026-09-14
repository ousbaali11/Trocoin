import { Module } from '@nestjs/common';
import { SmsModule } from '../sms/sms.module';
import { EmailModule } from '../email/email.module';
import { DevController } from './dev.controller';

@Module({
  imports: [SmsModule, EmailModule],
  controllers: [DevController],
})
export class DevModule {}
