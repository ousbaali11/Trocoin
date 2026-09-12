import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateReviewDto } from './dto/create-review.dto';
import { ReviewsService } from './reviews.service';

@Controller()
export class ReviewsController {
  constructor(private reviewsService: ReviewsService) {}

  @UseGuards(JwtAuthGuard)
  @Post('transactions/:id/review')
  create(@Req() req: any, @Param('id', ParseUUIDPipe) transactionId: string, @Body() dto: CreateReviewDto) {
    return this.reviewsService.createForTransaction(transactionId, req.user.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('users/me/reviews-received')
  listReceived(@Req() req: any) {
    return this.reviewsService.listForUser(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('users/me/reviews-given')
  listGiven(@Req() req: any) {
    return this.reviewsService.listMine(req.user.userId);
  }

  // Public : les avis reçus par un utilisateur font partie de sa réputation visible.
  @Get('users/:id/reviews')
  listForUser(@Param('id', ParseUUIDPipe) userId: string) {
    return this.reviewsService.listForUser(userId);
  }
}
