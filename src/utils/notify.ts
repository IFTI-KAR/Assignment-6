import type { NotificationType, Prisma } from "../generated/prisma/client";
import { type DbClient, prisma } from "../lib/prisma";

type NotifyInput = {
  userIds: string | string[];
  type: NotificationType;
  title: string;
  message: string;
  metadata?: Prisma.InputJsonValue;
};

/** Fan-out in-app notifications (one row per recipient) in a single INSERT. */
export const notify = async (input: NotifyInput, db: DbClient = prisma) => {
  const ids = [...new Set(Array.isArray(input.userIds) ? input.userIds : [input.userIds])].filter(
    Boolean,
  );
  if (!ids.length) return;
  await db.notification.createMany({
    data: ids.map((userId) => ({
      userId,
      type: input.type,
      title: input.title,
      message: input.message,
      metadata: input.metadata,
    })),
  });
};
