import { and, eq } from 'drizzle-orm';
import type { Request } from 'express';
import type { Tx } from '../db/client.js';
import { companyMemberships, users, companies } from '../db/schema.js';
import type { Role } from '../auth/permissions.js';
import { issuePasswordToken } from '../routes/auth.js';
import { sendMail, mailEnabled } from '../lib/mailer.js';
import { audit } from '../lib/audit.js';
import { config } from '../config.js';

/**
 * Adds (or re-activates) a user in a company. Unknown emails get an account without a password
 * plus an invitation link to set one. Returns the membership and whether an invite was sent.
 */
export async function addMember(tx: Tx, req: Request, companyId: string, email: string, name: string, role: Role) {
  const normalized = email.trim().toLowerCase();
  let user = await tx.query.users.findFirst({ where: eq(users.email, normalized) });
  let invited = false;
  let inviteLink: string | null = null;
  if (!user) {
    [user] = await tx.insert(users).values({ email: normalized, name }).returning();
    invited = true;
  }
  const existing = await tx.query.companyMemberships.findFirst({
    where: and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.userId, user.id)),
  });
  let membership;
  if (existing) {
    [membership] = await tx.update(companyMemberships).set({ role, status: 'ACTIVE' })
      .where(eq(companyMemberships.id, existing.id)).returning();
  } else {
    [membership] = await tx.insert(companyMemberships)
      .values({ companyId, userId: user.id, role, invitedBy: req.user?.id }).returning();
  }
  const company = await tx.query.companies.findFirst({ where: eq(companies.id, companyId) });
  if (invited || !user.passwordHash) {
    const token = await issuePasswordToken(user.id, 'INVITE', tx);
    const link = `${config.appUrl}/accept-invite?token=${token}`;
    await sendMail(user.email, `Undangan bergabung — ${company?.name}`,
      `Halo ${user.name},\n\nAnda diundang sebagai ${role} di ${company?.name} pada Rental Management System.\nBuat password Anda melalui tautan berikut (berlaku 72 jam):\n${link}`);
    invited = true;
    // Without SMTP the email never leaves the server: hand the link to the inviting admin so they can pass it on.
    if (!mailEnabled()) inviteLink = link;
  } else {
    await sendMail(user.email, `Akses baru — ${company?.name}`,
      `Halo ${user.name},\n\nAnda kini memiliki akses ${role} ke ${company?.name}. Login di ${config.appUrl} lalu pilih perusahaan melalui Company Switcher.`);
  }
  await audit(tx, req, {
    action: existing ? 'membership.reactivate' : 'membership.add', entityType: 'membership', entityId: membership.id,
    summary: `${normalized} sebagai ${role}`, after: { email: normalized, role },
  }, companyId);
  return { membership, user: { id: user.id, email: user.email, name: user.name }, invited, inviteLink };
}
