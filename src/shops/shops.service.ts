import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { normalizeFrenchMobile } from '../common/validators/french-phone';
import { User } from '../users/user.entity';
import { ShopMember } from './shop-member.entity';
import { NotificationsService } from '../notifications/notifications.service';

const MAX_MEMBERS = 10;

@Injectable()
export class ShopsService {
  constructor(
    @InjectRepository(ShopMember) private membersRepo: Repository<ShopMember>,
    @InjectRepository(User) private usersRepo: Repository<User>,
    private notifications: NotificationsService,
  ) {}

  private async requirePro(ownerId: string): Promise<User> {
    const owner = await this.usersRepo.findOne({ where: { id: ownerId } });
    if (!owner) throw new NotFoundException('Utilisateur introuvable.');
    if (owner.accountType !== 'professionnel') {
      throw new BadRequestException('La gestion multi-utilisateurs est réservée aux comptes professionnels.');
    }
    return owner;
  }

  /** Membres de MA boutique. */
  async listMembers(ownerId: string) {
    await this.requirePro(ownerId);
    const members = await this.membersRepo.find({ where: { ownerId }, order: { createdAt: 'ASC' } });
    const out: any[] = [];
    for (const m of members) {
      const u = await this.usersRepo.findOne({ where: { id: m.memberId } });
      out.push({ id: m.id, role: m.role, createdAt: m.createdAt, user: u ? { id: u.id, displayName: u.displayName, phoneMasked: u.phoneNumber.replace(/^(\+33\d)\d{6}(\d{2})$/, '$1 •• •• •• $2') } : null });
    }
    return out;
  }

  /** Invite par numéro de mobile : la personne doit déjà avoir un compte Trocoin. */
  async addMember(ownerId: string, rawPhone: string) {
    await this.requirePro(ownerId);
    const phone = normalizeFrenchMobile(rawPhone);
    if (!phone) throw new BadRequestException('Numéro de mobile français invalide.');
    const member = await this.usersRepo.findOne({ where: { phoneNumber: phone } });
    if (!member || member.deletedAt) throw new NotFoundException('Aucun compte Trocoin avec ce numéro : la personne doit d\'abord s\'inscrire.');
    if (member.id === ownerId) throw new BadRequestException('Vous êtes déjà propriétaire de cette boutique.');
    if (member.accountType === 'admin') throw new BadRequestException('Un administrateur ne peut pas être membre d\'une boutique.');
    const count = await this.membersRepo.count({ where: { ownerId } });
    if (count >= MAX_MEMBERS) throw new BadRequestException(`Maximum ${MAX_MEMBERS} membres par boutique.`);
    const existing = await this.membersRepo.findOne({ where: { ownerId, memberId: member.id } });
    if (existing) throw new BadRequestException('Cette personne gère déjà votre boutique.');
    await this.membersRepo.save(this.membersRepo.create({ ownerId, memberId: member.id, invitedBy: ownerId }));
    // AUDIT §69 : la personne ajoutée est prévenue et sait comment se retirer
    const owner = await this.usersRepo.findOne({ where: { id: ownerId } });
    await this.notifications.notify(member.id, { type: 'systeme', title: 'Vous gérez maintenant une boutique', body: `${owner?.shopName || owner?.displayName || 'Un professionnel'} vous a ajouté(e) comme membre de sa boutique : vous pouvez publier et gérer ses annonces. Pour vous retirer : Paramètres → Boutiques gérées.`, link: '/compte/parametres' });
    return this.listMembers(ownerId);
  }

  async removeMember(ownerId: string, memberId: string) {
    const r = await this.membersRepo.delete({ ownerId, memberId });
    if (!r.affected) throw new NotFoundException('Membre introuvable.');
    return { removed: true };
  }

  /** Boutiques que JE gère (en tant que membre). */
  async shopsManagedBy(memberId: string) {
    const rows = await this.membersRepo.find({ where: { memberId } });
    const out: any[] = [];
    for (const r of rows) {
      const owner = await this.usersRepo.findOne({ where: { id: r.ownerId } });
      if (owner && !owner.deletedAt) out.push({ ownerId: owner.id, shopName: owner.shopName || owner.displayName, role: r.role });
    }
    return out;
  }

  async managedOwnerIds(memberId: string): Promise<string[]> {
    const rows = await this.membersRepo.find({ where: { memberId } });
    return rows.map((r) => r.ownerId);
  }

  /** true si userId est propriétaire ou membre de la boutique ownerId. */
  async canActFor(userId: string, ownerId: string): Promise<boolean> {
    if (userId === ownerId) return true;
    if ((await this.membersRepo.count({ where: { ownerId, memberId: userId } })) === 0) return false;
    // AUDIT §73 : un membre de boutique ne peut pas agir au nom d'un propriétaire suspendu ou supprimé (il remettait ses
    // annonces en ligne et les acheteurs pouvaient le payer malgré la suspension)
    const owner = await this.usersRepo.findOne({ where: { id: ownerId } });
    return !!owner && !owner.suspendedAt && !owner.deletedAt;
  }

  async leave(memberId: string, ownerId: string) {
    const r = await this.membersRepo.delete({ ownerId, memberId });
    if (!r.affected) throw new NotFoundException('Vous ne gérez pas cette boutique.');
    return { left: true };
  }
}
