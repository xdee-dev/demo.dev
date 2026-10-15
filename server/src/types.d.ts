import type { Permission, Role } from './auth/permissions.js';

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email: string; name: string; isSuperAdmin: boolean };
      session?: { id: string; csrfToken: string };
      ctx?: { companyId: string; role: Role; permissions: Set<Permission>; timezone: string; companyName: string };
    }
  }
}
export {};
