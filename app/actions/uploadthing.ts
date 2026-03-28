"use server";

import { UTApi } from "uploadthing/server";

const utapi = new UTApi();

/**
 * Deletes files from UploadThing storage.
 * @param fileKeys Array of file keys to delete (or a single key)
 */
export async function deleteCloudFiles(fileKeys: string | string[]) {
  try {
    const keys = Array.isArray(fileKeys) ? fileKeys : [fileKeys];
    if (keys.length === 0) return { success: true };

    console.log("Deleting files from cloud:", keys);
    const result = await utapi.deleteFiles(keys);
    
    return { success: result.success, deletedCount: keys.length };
  } catch (error) {
    console.error("Cloud deletion failed:", error);
    return { success: false, error: "Failed to delete from cloud" };
  }
}
