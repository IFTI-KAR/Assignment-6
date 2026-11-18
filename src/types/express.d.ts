import type { Role, UserStatus } from "../generated/prisma/client";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
