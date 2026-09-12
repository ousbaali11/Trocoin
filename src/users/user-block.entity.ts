import { CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import { DATE_TYPE } from '../config/db';

/** blockerId ne veut plus recevoir de messages de blockedId. */
@Entity('user_blocks')
export class UserBlock {
  @PrimaryColumn()
  blockerId: string;

  @PrimaryColumn()
  blockedId: string;

  @CreateDateColumn({ type: DATE_TYPE })
  createdAt: Date;
}
