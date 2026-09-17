import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Listing } from '../listings/listing.entity';
import { Transaction } from '../payments/transaction.entity';
import { User } from '../users/user.entity';
import { BoxtalShippingProvider } from './boxtal-shipping.provider';
import { MockShippingProvider } from './mock-shipping.provider';
import { Shipment } from './shipment.entity';
import { ShippingController } from './shipping.controller';
import { ShippingDiagnosticController } from './shipping-diagnostic.controller';
import { ShippingOptionsController } from './shipping-options.controller';
import { SHIPPING_PROVIDER } from './shipping.constants';
import { ShippingService } from './shipping.service';
import { UnconfiguredShippingProvider } from './unconfigured-shipping.provider';

@Module({
  imports: [TypeOrmModule.forFeature([Shipment, Transaction, Listing, User]), ConfigModule, ConversationsModule],
  controllers: [ShippingController, ShippingDiagnosticController, ShippingOptionsController],
  providers: [
    ShippingService,
    {
      provide: SHIPPING_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const provider = config.get<string>('SHIPPING_PROVIDER') || (process.env.NODE_ENV === 'production' ? 'none' : 'mock');
        if (provider === 'mock') return new MockShippingProvider();
        if (provider === 'boxtal') return new BoxtalShippingProvider(config);
        return new UnconfiguredShippingProvider();
      },
    },
  ],
  exports: [ShippingService],
})
export class ShippingModule {}
