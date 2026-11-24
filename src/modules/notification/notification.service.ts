import { AppError } from "../../errors/AppError";
import type { Prisma } from "../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { buildMeta, getPagination } from "../../utils/pagination";
import type { ListNotificationsQuery } from "./notification.validation";

const list = async (userId: string, query: ListNotificationsQuery) => {
  const { page, limit, isRead, type } = query;
  const where: Prisma.NotificationWhereInput = {
    userId,
    ...(isRead !== undefined && { isRead }),
    ...(type && { type }),
  };
  const [data, total, unread] = await prisma.$transaction([
    prisma.notification.findMany({
      where,
      ...getPagination(page, limit),
      orderBy: { createdAt: "desc" },
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, isRead: false } }),
  ]);
  return { data, meta: buildMeta(page, limit, total), unread };
};

const markRead = async (userId: string, id: string) => {
  const { count } = await prisma.notification.updateMany({
    where: { id, userId },
    data: { isRead: true },
  });
  if (count === 0) throw new AppError(404, "Notification not found");
  return prisma.notification.findUniqueOrThrow({ where: { id } });
};

const markAllRead = async (userId: string) => {
  const { count } = await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });
  return { updated: count };
};

export const NotificationService = { list, markRead, markAllRead };
