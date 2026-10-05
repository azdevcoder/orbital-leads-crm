/** Papéis de usuário: cliente (uso normal), vendedor e administrador. */

export const ROLE_IDS = ["user", "vendedor", "admin"] as const;
export type RoleId = (typeof ROLE_IDS)[number];

export const ROLE_LABELS: Record<RoleId, string> = {
  user: "Cliente",
  vendedor: "Vendedor",
  admin: "Administrador",
};

export function roleLabel(role: string | null | undefined): string {
  if (role && (ROLE_IDS as readonly string[]).includes(role)) {
    return ROLE_LABELS[role as RoleId];
  }
  return ROLE_LABELS.user;
}
