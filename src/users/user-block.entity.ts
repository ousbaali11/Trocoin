import { CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** blockerId ne veut plus recevoir de messages de blockedId. */
@Entity('user_blocks')
export class UserBlock {
  @PrimaryColumn()
  blockerId: string;

  @PrimaryColumn()
  blockedId: string;

  @CreateDateColumn()
  createdAt: Date;
}
