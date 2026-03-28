import { createUploadthing, type FileRouter } from "uploadthing/server";

const f = createUploadthing();

// File router for handling all file uploads
export const ourFileRouter = {
    // Document upload endpoint - accepts PDF, images, documents
    documentUploader: f({
        pdf: { maxFileSize: "16MB" },
        image: { maxFileSize: "8MB" },
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

    // Template upload endpoint - accepts PDF and images
    templateUploader: f({
        pdf: { maxFileSize: "16MB" },
        image: { maxFileSize: "8MB" },
    })
        .middleware(() => ({ userId: "user-123" }))
        .onUploadComplete(async ({ file }) => {
            console.log("Template uploaded:", file.name);
            return { url: file.url };
        }),

    // Signed document upload endpoint
    signedDocUploader: f({
        pdf: { maxFileSize: "16MB" },
        image: { maxFileSize: "8MB" },
    })
        .middleware(() => ({ userId: "user-123" }))
        .onUploadComplete(async ({ file }) => {
            console.log("Signed document uploaded:", file.name);
            return { url: file.url };
        }),
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;
