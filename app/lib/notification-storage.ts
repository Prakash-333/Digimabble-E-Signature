"use client";

import { getScopedStorageItem, setScopedStorageItem } from "./user-storage";

const SEEN_NOTIFICATIONS_STORAGE_KEY = "smartdocs.seen-notifications.v1";
const HIDDEN_NOTIFICATIONS_STORAGE_KEY = "smartdocs.hidden-notifications.v1";

const readIdList = (key: string, userId?: string | null) => {
  const raw = getScopedStorageItem(key, userId);
  if (!raw) return [] as string[];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
};

export const getSeenNotificationIds = (userId?: string | null) =>
  new Set(readIdList(SEEN_NOTIFICATIONS_STORAGE_KEY, userId));

export const markNotificationSeen = (userId: string | null | undefined, notificationId: string) => {
  if (!userId) return;
  const next = Array.from(new Set([...readIdList(SEEN_NOTIFICATIONS_STORAGE_KEY, userId), notificationId]));
  setScopedStorageItem(SEEN_NOTIFICATIONS_STORAGE_KEY, userId, JSON.stringify(next));
};

export const markNotificationsSeen = (userId: string | null | undefined, notificationIds: string[]) => {
  if (!userId || notificationIds.length === 0) return;
  const next = Array.from(new Set([...readIdList(SEEN_NOTIFICATIONS_STORAGE_KEY, userId), ...notificationIds]));
  setScopedStorageItem(SEEN_NOTIFICATIONS_STORAGE_KEY, userId, JSON.stringify(next));
};

export const getHiddenNotificationIds = (userId?: string | null) =>
  new Set(readIdList(HIDDEN_NOTIFICATIONS_STORAGE_KEY, userId));

export const hideNotificationForUser = (userId: string | null | undefined, notificationId: string) => {
  if (!userId) return;
  const next = Array.from(new Set([...readIdList(HIDDEN_NOTIFICATIONS_STORAGE_KEY, userId), notificationId]));
  setScopedStorageItem(HIDDEN_NOTIFICATIONS_STORAGE_KEY, userId, JSON.stringify(next));
};
