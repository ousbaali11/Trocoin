import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Listing } from '../listings/listing.entity';
import { Transaction } from '../payments/transaction.entity';
import { User } from '../users/user.entity';
import { MockShippingProvider } from './mock-shipping.provider';
import { Shipment } from './shipment.entity';
import { ShippingController } from './shipping.controller';
import { SHIPPING_PROVIDER } from './shipping.constants';
import { ShippingService } from './shipping.service';
import { UnconfiguredShippingProvider } from './unconfigured-shipping.provider';

@Module({
  imports: [TypeOrmModule.forFeature([Shipment, Transaction, Listing, User]), ConfigModule],
  controllers: [ShippingController],
  providers: [
    ShippingService,
    {
      provide: SHIPPING_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const provider = config.get<string>('SHIPPING_PROVIDER') || (process.env.NODE_ENV === 'production' ? 'none' : 'mock');
        // Phase 2 : if (provider === 'boxtal') return new BoxtalShippingProvider(config);
        if (provider === 'mock') return new MockShippingProvider();
        return new UnconfiguredShippingProvider();
      },
    },
  ],
  exports: [ShippingService],
})
export class ShippingModule {}
