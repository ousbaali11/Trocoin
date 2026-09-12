import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class StartConversationDto {
  @IsUUID()
  listingId: string;

  /** Premier message optionnel (envoyé dans la foulée). */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message?: string;
}
