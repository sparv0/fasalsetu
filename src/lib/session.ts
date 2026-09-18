import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { prisma } from "./prisma";

const COOKIE_NAME = "fs_uid";

export const getCurrentUser = cache(async () => {
  const store = await cookies();
  const uid = store.get(COOKIE_NAME)?.value;
  if (!uid) return null;
  return prisma.user.findUnique({ where: { id: uid } });
});

export async function setCurrentUser(userId: string) {
  const store = await cookies();
  store.set(COOKIE_NAME, userId, { path: "/", httpOnly: true, sameSite: "lax" });
}

export async function clearCurrentUser() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

// For pages: bounce to login when the viewer lacks the role.
export async function requirePageUser(...roles: Role[]) {
  const user = await getCurrentUser();
  if (!user || (roles.length > 0 && !roles.includes(user.role))) redirect("/login");
  return user;
}

export function homePathFor(role: Role) {
  return { FARMER: "/farmer", FPO: "/fpo", BUYER: "/buyer", ADMIN: "/admin" }[role];
}
