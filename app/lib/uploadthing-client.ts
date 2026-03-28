"use client";

import { generateReactHelpers } from "@uploadthing/react";
import type { OurFileRouter } from "./uploadthing-server";

console.log("UploadThing client initialized");

// Configure the API URL for client-side uploads
export const { useUploadThing, uploadFiles } = generateReactHelpers<OurFileRouter>({
    fetch: async (url, init) => {
        const response = await fetch(url, init);
        if (!response.ok) {
            console.error(`UploadThing API error: ${response.status} ${response.statusText}`);
            try {
                const clone = response.clone();
                const text = await clone.text();
                console.error("Server response:", text);
            } catch (e) {
                console.error("Could not read error response");
            }
        }
        return response;
    }
});