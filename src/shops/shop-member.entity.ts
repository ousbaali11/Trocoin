import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Multi-utilisateurs : `memberId` peut gérer les annonces de la boutique
 * (compte professionnel) `ownerId`. Rôle unique « gestionnaire » au MVP.
 */
@Entity('shop_members')
@Index(['ownerId', 'memberId'], { unique: true })
export class ShopMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  ownerId: string;

  @Index()
  @Column()
  memberId: string;

  @Column({ type: 'varchar', default: 'gestionnaire' })
  role: 'gestionnaire';

  @Column()
  invitedBy: string;

  @CreateDateColumn()
  createdAt: Date;
}
