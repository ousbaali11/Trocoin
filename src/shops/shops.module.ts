import { Body, Controller, Delete, Get, Module, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { User } from '../users/user.entity';
import { ShopMember } from './shop-member.entity';
import { ShopsService } from './shops.service';

class InviteMemberDto {
  @IsString() @MinLength(10) @MaxLength(20)
  phoneNumber: string;
}

@UseGuards(JwtAuthGuard)
@Controller('users/me')
class ShopsController {
  constructor(private shops: ShopsService) {}

  @Get('shop/members')
  members(@Req() req: any) {
    return this.shops.listMembers(req.user.userId);
  }

  @Post('shop/members')
  invite(@Req() req: any, @Body() dto: InviteMemberDto) {
    return this.shops.addMember(req.user.userId, dto.phoneNumber);
  }

  @Delete('shop/members/:memberId')
  remove(@Req() req: any, @Param('memberId', ParseUUIDPipe) memberId: string) {
    return this.shops.removeMember(req.user.userId, memberId);
  }

  @Get('shops')
  managed(@Req() req: any) {
    return this.shops.shopsManagedBy(req.user.userId);
  }

  @Delete('shops/:ownerId')
  leave(@Req() req: any, @Param('ownerId', ParseUUIDPipe) ownerId: string) {
    return this.shops.leave(req.user.userId, ownerId);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([ShopMember, User])],
  controllers: [ShopsController],
  providers: [ShopsService],
  exports: [ShopsService],
})
export class ShopsModule {}
