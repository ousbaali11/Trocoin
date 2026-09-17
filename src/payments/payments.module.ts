import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Listing } from '../listings/listing.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { ShippingModule } from '../shipping/shipping.module';
import { MockCheckoutController } from './mock-checkout.controller';
import { DisabledPaymentProvider } from './disabled-payment.provider';
import { MockPaymentProvider } from './mock-payment.provider';
import { PaymentsController } from './payments.controller';
import { PAYMENT_PROVIDER } from './payments.constants';
import { PaymentsService } from './payments.service';
import { PaypalPaymentProvider } from './paypal-payment.provider';
import { StripePaymentProvider } from './stripe-payment.provider';
import { Shipment } from '../shipping/shipment.entity';
import { Transaction } from './transaction.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Transaction, Listing, Shipment]), ConfigModule, UsersModule, NotificationsModule, ConversationsModule, ShippingModule],
  controllers: [PaymentsController, MockCheckoutController],
  providers: [
    PaymentsService,
    {
      provide: PAYMENT_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const provider = config.get<string>('PAYMENT_PROVIDER') || 'mock';
        if (provider === 'stripe') return new StripePaymentProvider(config);
        if (provider === 'paypal') return new PaypalPaymentProvider(config);
        if (provider === 'disabled') return new DisabledPaymentProvider();
        return new MockPaymentProvider();
      },
    },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
