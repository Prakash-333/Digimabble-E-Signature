import { createUploadthing, type FileRouter } from "uploadthing/server";

const f = createUploadthing();

// File router for handling all file uploads
export const ourFileRouter = {
    // Document upload endpoint - accepts all file types
    documentUploader: f({
        pdf: { maxFileSize: "16MB" },
        image: { maxFileSize: "16MB" },
        text: { maxFileSize: "16MB" },
        blob: { maxFileSize: "16MB" },
    })
        .middleware(() => ({ userId: "user-123" }))
        .onUploadComplete(async ({ file }) => {
            console.log("Document uploaded:", file.name);
            return { url: file.url };
        }),

    // Avatar upload endpoint - accepts images only
    avatarUploader: f({
        image: { maxFileSize: "4MB" },
    })
        .middleware(() => ({ userId: "user-123" }))
        .onUploadComplete(async ({ file }) => {
            console.log("Avatar uploaded:", file.name);
            return { url: file.url };
        }),

    // Template upload endpoint - accepts all file types
    templateUploader: f({
        pdf: { maxFileSize: "16MB" },
        image: { maxFileSize: "16MB" },
        text: { maxFileSize: "16MB" },
        blob: { maxFileSize: "16MB" },
    })
        .middleware(() => ({ userId: "user-123" }))
        .onUploadComplete(async ({ file }) => {
            console.log("Template uploaded:", file.name);
            return { url: file.url };
        }),

    // Signed document upload endpoint
    signedDocUploader: f({
        pdf: { maxFileSize: "16MB" },
        image: { maxFileSize: "16MB" },
        text: { maxFileSize: "16MB" },
        blob: { maxFileSize: "16MB" },
    })
        .middleware(() => ({ userId: "user-123" }))
        .onUploadComplete(async ({ file }) => {
            console.log("Signed document uploaded:", file.name);
            return { url: file.url };
        }),
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;
