import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SmsModule } from '../sms/sms.module';
import { PhoneVerification } from './otp.entity';
import { OtpService } from './otp.service';

@Module({
  imports: [TypeOrmModule.forFeature([PhoneVerification]), SmsModule],
  providers: [OtpService],
  exports: [OtpService],
})
export class OtpModule {}
