export type Id<T> = T & { readonly __brand: unique symbol };

export interface User {
  id: Id<number>;
  name: string;
  email: string;
  role: "admin" | "editor" | "viewer";
}

export interface Repository<T> {
  findById(id: Id<number>): T | undefined;
  findAll(): T[];
  save(item: T): void;
}

export type ReadonlyUser = Readonly<User>;

export type UserRole = User["role"];

export type RolePermissions = {
  readonly [K in UserRole]: string[];
};

export type EventName = `on${Capitalize<string>}`;

export const DEFAULT_PERMISSIONS = {
  admin: ["read", "write", "delete"],
  editor: ["read", "write"],
  viewer: ["read"],
} as const satisfies RolePermissions;
