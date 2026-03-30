"use client";

export const getUserStorageKey = (baseKey: string, userId?: string | null) =>
  userId ? `${baseKey}:${userId}` : baseKey;

export const getScopedStorageItem = (
  baseKey: string,
  userId?: string | null
) => {
  const scopedKey = getUserStorageKey(baseKey, userId);
  const scopedValue = localStorage.getItem(scopedKey);

  if (scopedValue !== null) {
    return scopedValue;
  }

  return userId ? null : localStorage.getItem(baseKey);
};

export const setScopedStorageItem = (
  baseKey: string,
  userId: string | null | undefined,
  value: string
) => {
  localStorage.setItem(getUserStorageKey(baseKey, userId), value);
  if (userId) {
    localStorage.removeItem(baseKey);
  }
};

export const removeScopedStorageItem = (
  baseKey: string,
  userId?: string | null
) => {
  localStorage.removeItem(getUserStorageKey(baseKey, userId));
  if (userId) {
    localStorage.removeItem(baseKey);
  }
};
