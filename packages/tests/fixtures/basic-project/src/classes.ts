import type { Repository, User } from "./types.js";
import type { Id } from "./types.js";

export class InMemoryRepository<T extends { id: Id<number> }>
  implements Repository<T>
{
  private readonly items = new Map<number, T>();

  findById(id: Id<number>): T | undefined {
    return this.items.get(id as unknown as number);
  }

  findAll(): T[] {
    return Array.from(this.items.values());
  }

  save(item: T): void {
    this.items.set(item.id as unknown as number, item);
  }
}

export class UserRepository extends InMemoryRepository<User> {
  findByEmail(email: string): User | undefined {
    return this.findAll().find((u) => u.email === email);
  }

  findByRole(role: User["role"]): User[] {
    return this.findAll().filter((u) => u.role === role);
  }
}
