/**
 * Création / promotion du premier compte administrateur.
 *
 * Usage :  npm run create-admin -- +33612345678 ["Nom affiché"]
 *
 * S'exécute uniquement en ligne de commande, avec un accès direct à la base :
 * il n'existe volontairement AUCUNE route HTTP permettant de devenir admin.
 * Le compte est créé s'il n'existe pas (téléphone vérifié) puis passé en
 * accountType='admin'. Une ligne d'audit est écrite (adminId = 'cli').
 */
import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { normalizeFrenchMobile } from '../common/validators/french-phone';
import { buildDataSourceOptions } from '../data-source';
import { AdminAuditLog } from './admin-audit-log.entity';
import { User } from '../users/user.entity';

loadEnv();

async function main() {
  const [rawPhone, ...nameParts] = process.argv.slice(2);
  if (!rawPhone) {
    console.error('Usage : npm run create-admin -- +33612345678 ["Nom affiché"]');
    process.exit(1);
  }
  const phone = normalizeFrenchMobile(rawPhone);
  if (!phone) {
    console.error('Numéro invalide : seul un mobile français (+33 6/7) est accepté.');
    process.exit(1);
  }

  const ds = new DataSource({ ...buildDataSourceOptions(process.env), synchronize: false, migrationsRun: false });
  await ds.initialize();
  try {
    const users = ds.getRepository(User);
    const audit = ds.getRepository(AdminAuditLog);
    let user = await users.findOne({ where: { phoneNumber: phone } });
    const displayName = nameParts.join(' ').trim() || undefined;
    if (!user) {
      user = await users.save(
        users.create({ phoneNumber: phone, phoneVerified: true, displayName: displayName || 'Administrateur', accountType: 'admin' }),
      );
      console.log(`Compte admin créé : ${user.id} (${phone})`);
    } else {
      if (user.deletedAt) throw new Error('Ce compte a été supprimé.');
      await users.update(user.id, { accountType: 'admin', suspendedAt: null as any, ...(displayName ? { displayName } : {}) });
      console.log(`Compte ${user.id} (${phone}) promu administrateur.`);
    }
    await audit.save(audit.create({ adminId: 'cli', action: 'user.promote_admin', targetType: 'user', targetId: user.id, details: { via: 'create-admin script' } }));
    console.log('Connectez-vous avec ce numéro (OTP) : le rôle admin est lu en base à chaque requête.');
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
