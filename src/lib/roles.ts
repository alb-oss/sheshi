export const Roles = {
  User: "user",
  Moderator: "moderator",
  Admin: "admin",
} as const;

type RoleCarrier = {
  roles?: readonly string[] | null;
};

export function hasRole(user: RoleCarrier | null | undefined, role: string) {
  return Boolean(user?.roles?.includes(role));
}

export function canModerate(user: RoleCarrier | null | undefined) {
  return hasRole(user, Roles.Moderator) || hasRole(user, Roles.Admin);
}

export function canAdmin(user: RoleCarrier | null | undefined) {
  return hasRole(user, Roles.Admin);
}
