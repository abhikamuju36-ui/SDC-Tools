"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { assertActionPermission } from "@/lib/require-permission";
import { ROLES, type AppRole } from "@/lib/permissions";

export type ManagedUser = {
  id: number;
  email: string;
  name: string;
  role: AppRole;
  active: boolean;
};

// The only screen that can change a User's role — before this, it took a raw
// DB write. ELT-only (users:manage), same as every other mutation here.
export async function listUsersForAdmin(): Promise<ManagedUser[]> {
  await assertActionPermission("users:manage");
  const users = await prisma.user.findMany({ orderBy: { email: "asc" } });
  return users.map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, active: u.active }));
}

export async function setUserRole(userId: number, role: AppRole): Promise<void> {
  await assertActionPermission("users:manage");
  if (!ROLES.includes(role)) throw new Error(`"${role}" is not a valid role.`);

  const before = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, role: true } });
  if (!before) throw new Error("That user no longer exists.");

  await prisma.user.update({ where: { id: userId }, data: { role } });
  await logAudit({
    action: "user.roleChange",
    entityType: "User",
    entityId: userId,
    summary: `${before.email} role changed ${before.role} → ${role}`,
    metadata: { before: before.role, after: role },
  });
  revalidatePath("/admin/users");
}
