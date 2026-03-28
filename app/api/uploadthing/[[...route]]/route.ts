import { createRouteHandler } from "uploadthing/next";
import { ourFileRouter } from "@/app/lib/uploadthing-server";

// Export the route handler for UploadThing - handles all routes under /api/uploadthing/*
const { GET, POST } = createRouteHandler({
    router: ourFileRouter,
});

export { GET, POST };

console.log("UploadThing API route handler initialized");
console.log("UPLOADTHING_TOKEN exists:", !!process.env.UPLOADTHING_TOKEN);