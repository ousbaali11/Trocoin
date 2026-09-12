import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { REPORT_REASONS, ReportReason } from '../report.entity';

export class CreateReportDto {
  @IsOptional() @IsUUID()
  listingId?: string;

  @IsOptional() @IsUUID()
  reportedUserId?: string;

  @IsOptional() @IsUUID()
  conversationId?: string;

  @IsIn(REPORT_REASONS)
  reason: ReportReason;

  @IsOptional() @IsString() @MaxLength(2000)
  details?: string;
}
