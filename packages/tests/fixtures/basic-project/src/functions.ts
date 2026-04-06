import type { User, UserRole, RolePermissions } from "./types.js";
import { DEFAULT_PERMISSIONS } from "./types.js";

export function getPermissions(role: UserRole): string[] {
  return DEFAULT_PERMISSIONS[role];
}

export function hasPermission(user: User, action: string): boolean {
  const perms = getPermissions(user.role);
  return perms.includes(action);
}

export function formatUser(user: User): string {
  return `${user.name} <${user.email}> (${user.role})`;
}

export function filterByRole<T extends Pick<User, "role">>(
  items: T[],
  role: UserRole
): T[] {
  return items.filter((item) => item.role === role);
}

export function groupByRole(users: User[]): Partial<Record<UserRole, User[]>> {
  const result: Partial<Record<UserRole, User[]>> = {};
  for (const user of users) {
    const group = result[user.role] ?? [];
    group.push(user);
    result[user.role] = group;
  }
  return result;
}

export function buildPermissionMap(roles: UserRole[]): Partial<RolePermissions> {
  const result: Partial<RolePermissions> = {};
  for (const role of roles) {
    (result as Record<UserRole, string[]>)[role] = DEFAULT_PERMISSIONS[role];
  }
  return result;
}
