"use client";

import { getScopedStorageItem, removeScopedStorageItem, setScopedStorageItem } from "./user-storage";

const SIGNATURE_STORAGE_KEY = "smartdocs.saved-signature.v1";

export const getStoredSignature = (userId?: string | null) =>
  getScopedStorageItem(SIGNATURE_STORAGE_KEY, userId);

export const setStoredSignature = (userId: string | null | undefined, dataUrl: string) => {
  if (!userId) return;
  setScopedStorageItem(SIGNATURE_STORAGE_KEY, userId, dataUrl);
};

export const removeStoredSignature = (userId?: string | null) => {
  removeScopedStorageItem(SIGNATURE_STORAGE_KEY, userId);
};
