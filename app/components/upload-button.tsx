"use client";

import { useUploadThing } from "../lib/uploadthing-client";
import { useState } from "react";
import { Upload, FileText, Image, X, Check, Loader2 } from "lucide-react";

interface UploadButtonProps {
    endpoint: "documentUploader" | "avatarUploader" | "templateUploader" | "signedDocUploader";
    onUploadComplete?: (urls: string[]) => void;
    accept?: string;
    maxFiles?: number;
    children?: React.ReactNode;
    className?: string;
}

export function UploadButton({
    endpoint,
    onUploadComplete,
    accept,
    maxFiles = 1,
    children,
    className = "",
}: UploadButtonProps) {
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [uploadedUrls, setUploadedUrls] = useState<string[]>([]);
    const [showSuccess, setShowSuccess] = useState(false);

    const { startUpload } = useUploadThing(endpoint, {
        onClientUploadComplete: (res) => {
            if (res) {
                const urls = res.map((r) => r.url);
                setUploadedUrls(urls);
                onUploadComplete?.(urls);
                setShowSuccess(true);
                setTimeout(() => setShowSuccess(false), 3000);
            }
        },
        onUploadError: (error) => {
            console.error("Upload error:", error);
            setUploading(false);
        },
        onUploadBegin: () => {
            setUploading(true);
            setUploadProgress(0);
        },
    });

    const handleUpload = async (files: File[]) => {
        setUploading(true);
        setUploadProgress(0);

        try {
            await startUpload(files);
        } catch (error) {
            console.error("Upload failed:", error);
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className={className}>
            <input
                type="file"
                accept={accept}
                multiple={maxFiles > 1}
                onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    if (files.length > 0) {
                        handleUpload(files);
                    }
                }}
                className="hidden"
                id={`upload-${endpoint}`}
            />
            <label
                htmlFor={`upload-${endpoint}`}
                className={`inline-flex cursor-pointer items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-violet-700 active:scale-95 ${uploading ? "opacity-50 cursor-not-allowed" : ""}`}
            >
                {uploading ? (
                    <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Uploading...
                    </>
                ) : showSuccess ? (
                    <>
                        <Check className="h-4 w-4" />
                        Uploaded!
                    </>
                ) : (
                    <>
                        <Upload className="h-4 w-4" />
                        {children || "Upload"}
                    </>
                )}
            </label>
        </div>
    );
}

// Simple file input that uploads to UploadThing
interface SimpleUploadProps {
    onUploadComplete: (url: string, fileName: string, fileSize: number) => void;
    accept?: string;
    className?: string;
    buttonText?: string;
}

export function SimpleUpload({
    onUploadComplete,
    accept = "image/*,.pdf",
    className = "",
    buttonText = "Upload File"
}: SimpleUploadProps) {
    const [uploading, setUploading] = useState(false);
    const [progress, setProgress] = useState(0);

    const { startUpload } = useUploadThing("documentUploader", {
        onClientUploadComplete: (res) => {
            if (res && res[0]) {
                const file = res[0];
                onUploadComplete(file.url, file.name, file.size);
            }
            setUploading(false);
            setProgress(0);
        },
        onUploadError: () => {
            setUploading(false);
            setProgress(0);
        },
        onUploadBegin: () => {
            setUploading(true);
            setProgress(10);
        },
    });

    const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length > 0) {
            setUploading(true);
            setProgress(20);
            try {
                await startUpload(files);
            } catch (error) {
                console.error("Upload error:", error);
            }
        }
    };

    return (
        <div className={className}>
            <input
                type="file"
                accept={accept}
                onChange={handleChange}
                className="hidden"
                id="simple-upload"
                disabled={uploading}
            />
            <label
                htmlFor="simple-upload"
                className={`inline-flex cursor-pointer items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-violet-700 active:scale-95 ${uploading ? "opacity-50 cursor-not-allowed" : ""}`}
            >
                {uploading ? (
                    <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Uploading... {progress}%
                    </>
                ) : (
                    <>
                        <Upload className="h-4 w-4" />
                        {buttonText}
                    </>
                )}
            </label>
        </div>
    );
}

// Avatar upload component
interface AvatarUploadProps {
    currentAvatar?: string;
    onUploadComplete: (url: string) => void;
    className?: string;
}

export function AvatarUpload({ currentAvatar, onUploadComplete, className = "" }: AvatarUploadProps) {
    const { startUpload } = useUploadThing("avatarUploader", {
        onClientUploadComplete: (res) => {
            if (res && res[0]) {
                onUploadComplete(res[0].url);
            }
        },
        onUploadError: (error) => {
            console.error("Avatar upload error:", error);
        },
    });

    const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length > 0) {
            await startUpload(files);
        }
    };

    return (
        <div className={className}>
            <input
                type="file"
                accept="image/*"
                onChange={handleChange}
                className="hidden"
                id="avatar-upload"
            />
            <label
                htmlFor="avatar-upload"
                className="cursor-pointer"
            >
                <div className="flex items-center gap-3">
                    <div className="relative h-12 w-12 overflow-hidden rounded-full bg-violet-100">
                        {currentAvatar ? (
                            <img
                                src={currentAvatar}
                                alt="Avatar"
                                className="h-full w-full object-cover"
                            />
                        ) : (
                            <div className="flex h-full w-full items-center justify-center">
                                <Image className="h-6 w-6 text-violet-600" />
                            </div>
                        )}
                    </div>
                    <span className="text-sm font-medium text-violet-600 hover:text-violet-700">
                        Change Avatar
                    </span>
                </div>
            </label>
        </div>
    );
}