"use client";

import { useState, useRef, useEffect } from "react";
import { useUploadThing } from "../../lib/uploadthing-client";
import { deleteCloudFiles } from "../../actions/uploadthing";
import { supabase } from "../../lib/supabase/browser";
import { getMissingTableMessage, isMissingSupabaseTable } from "../../lib/supabase/errors";
import { CloudUpload, FileText, Image as ImageIcon, Folder, X, File, FileSpreadsheet, Presentation, FileType, Briefcase, User, Check, MoreHorizontal, Download, Trash2, Loader2, List, LayoutGrid } from "lucide-react";

type DocumentCategory = "personal" | "company";

type StoredDocument = {
    id: string;
    name: string;
    size: number;
    type: string;
    category: DocumentCategory;
    uploadedAt: string;
    url: string; // UploadThing URL
    uploadthingKey?: string;
};

type MyDocumentRow = {
    id: string;
    owner_id: string;
    name: string;
    size: number;
    type: string;
    category: DocumentCategory;
    uploaded_at: string;
    url: string;
    uploadthing_key: string | null;
};

export default function MyDocumentsPage() {
    const [files, setFiles] = useState<File[]>([]);
    const [pendingCategory, setPendingCategory] = useState<DocumentCategory | null>(null);
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [showCategoryModal, setShowCategoryModal] = useState(false);
    const [selectedCategory, setSelectedCategory] = useState<DocumentCategory | null>(null);
    const [storedDocuments, setStoredDocuments] = useState<StoredDocument[]>([]);
    const [activeFilter, setActiveFilter] = useState<DocumentCategory | "all">("all");
    const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
    const [showSaveSuccess, setShowSaveSuccess] = useState(false);
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [userId, setUserId] = useState<string | null>(null);
    const [schemaError, setSchemaError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Load documents from Supabase on mount
    useEffect(() => {
        const loadDocuments = async () => {
            const { data } = await supabase.auth.getUser();
            const currentUser = data.user;
            if (!currentUser) return;
            setUserId(currentUser.id);

            const { data: rows, error } = await supabase
                .from("my_documents")
                .select("id, owner_id, name, size, type, category, uploaded_at, url, uploadthing_key")
                .eq("owner_id", currentUser.id)
                .order("uploaded_at", { ascending: false });

            if (error) {
                if (isMissingSupabaseTable(error, "my_documents")) {
                    setSchemaError(getMissingTableMessage("my_documents"));
                    console.warn("Missing Supabase table: public.my_documents");
                    return;
                }

                setSchemaError("Unable to load your documents right now. Please refresh and try again.");
                console.warn("Failed to load my_documents:", error);
                return;
            }

            setSchemaError(null);
            setStoredDocuments((rows ?? []).map((row: MyDocumentRow) => ({
                id: row.id,
                name: row.name,
                size: row.size,
                type: row.type,
                category: row.category,
                uploadedAt: row.uploaded_at,
                url: row.url,
                uploadthingKey: row.uploadthing_key ?? undefined,
            })));
        };

        loadDocuments();
    }, []);

    // UploadThing hook for document uploads
    const { startUpload, isUploading } = useUploadThing("documentUploader", {
        onClientUploadComplete: async (res) => {
            if (res) {
                if (!userId) {
                    console.error("No authenticated user for document upload");
                    return;
                }
                const category: DocumentCategory = pendingCategory || "personal";
                const newDocs: StoredDocument[] = res.map((file) => ({
                    id: file.key || Date.now().toString() + Math.random().toString(36).substr(2, 9),
                    name: file.name,
                    size: file.size,
                    type: file.type || "application/octet-stream",
                    category: category,
                    uploadedAt: new Date().toString(),
                    url: file.url,
                    uploadthingKey: file.key,
                }));

                const payload = newDocs.map((doc) => ({
                    owner_id: userId,
                    name: doc.name,
                    size: doc.size,
                    type: doc.type,
                    category: doc.category,
                    uploaded_at: doc.uploadedAt,
                    url: doc.url,
                    uploadthing_key: doc.uploadthingKey ?? doc.id,
                }));

                const { error } = await supabase.from("my_documents").insert(payload);
                if (error) {
                    if (isMissingSupabaseTable(error, "my_documents")) {
                        setSchemaError(getMissingTableMessage("my_documents"));
                    } else {
                        setSchemaError("Upload finished, but saving the document record failed. Please try again.");
                        console.warn("Failed to save my_documents:", error);
                    }
                    return;
                }

                setSchemaError(null);
                setStoredDocuments((prev) => [...newDocs, ...prev]);

                setPendingCategory(null);
                setShowUploadModal(false);
                setShowSaveSuccess(true);
                setTimeout(() => setShowSaveSuccess(false), 3000);
            }
        },
        onUploadError: (error) => {
            console.error("Upload error:", error);
            setSchemaError(`Upload failed: ${error.message}`);
            setPendingCategory(null);
            setShowUploadModal(false);
        },
    });

    const handleUploadFiles = async (files: File[]) => {
        if (files.length > 0) {
            await startUpload(files);
        }
    };

    // Legacy handler for backwards compatibility
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        e.preventDefault();
        if (e.target.files && e.target.files[0]) {
            const newFiles = Array.from(e.target.files);
            handleUploadFiles(newFiles);
        }
    };

    const handleButtonClick = () => {
        if (schemaError) {
            return;
        }
        setShowUploadModal(true);
    };

    const handleUploadTypeSelect = (category: DocumentCategory) => {
        setPendingCategory(category);
        setShowUploadModal(false);
        inputRef.current?.click();
    };

    // This function is deprecated - we now use UploadThing directly
    // Keeping for backwards compatibility but not used

    const removeFile = (index: number) => {
        setFiles((prev) => prev.filter((_, i) => i !== index));
    };

    const deleteDocument = (id: string) => {
        const remove = async () => {
            const target = storedDocuments.find((doc) => doc.id === id);
            const updatedDocs = storedDocuments.filter((doc) => doc.id !== id);
            setStoredDocuments(updatedDocs);

            if (target?.uploadthingKey) {
                await deleteCloudFiles(target.uploadthingKey);
            }

            if (target?.id) {
                const { error } = await supabase.from("my_documents").delete().eq("id", target.id);
                if (error) {
                    if (isMissingSupabaseTable(error, "my_documents")) {
                        setSchemaError(getMissingTableMessage("my_documents"));
                    } else {
                        setSchemaError("Deleting the document record failed. Please refresh and try again.");
                        console.warn("Failed to delete from my_documents:", error);
                    }
                }
            }
        };

        void remove();

        setOpenMenuId(null);
    };

    const downloadDocument = (doc: StoredDocument) => {
        // If we have a real UploadThing URL, open it in a new tab
        if (doc.url && doc.url.startsWith('http')) {
            window.open(doc.url, '_blank');
        } else {
            // Fallback: Create a simple text file with document info as demo
            const content = `Document: ${doc.name}\nSize: ${formatFileSize(doc.size)}\nCategory: ${doc.category}\nUploaded: ${new Date(doc.uploadedAt).toLocaleString()}`;
            const blob = new Blob([content], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = doc.name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
        setOpenMenuId(null);
    };

    const formatFileSize = (bytes: number) => {
        if (bytes === 0) return "0 Bytes";
        const k = 1024;
        const sizes = ["Bytes", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
        });
    };

    const getFileIcon = (fileName: string) => {
        const ext = fileName.split(".").pop()?.toLowerCase();
        if (["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext || "")) {
            return <ImageIcon className="h-6 w-6 text-violet-500" />;
        } else if (ext === "pdf") {
            return <FileText className="h-6 w-6 text-red-500" />;
        } else if (["doc", "docx", "odt", "rtf"].includes(ext || "")) {
            return <File className="h-6 w-6 text-blue-500" />;
        } else if (["xls", "xlsx", "ods"].includes(ext || "")) {
            return <FileSpreadsheet className="h-6 w-6 text-green-500" />;
        } else if (["ppt", "pptx", "odp"].includes(ext || "")) {
            return <Presentation className="h-6 w-6 text-orange-500" />;
        } else if (["txt"].includes(ext || "")) {
            return <FileType className="h-6 w-6 text-slate-500" />;
        }
        return <Folder className="h-6 w-6 text-slate-500" />;
    };

    const getPreview = (doc: StoredDocument) => {
        const ext = doc.name.split(".").pop()?.toLowerCase();
        if (["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext || "") && doc.url) {
            return <img src={doc.url} alt={doc.name} className="h-full w-full object-cover" />;
        }

        return (
            <div className="flex h-full w-full flex-col justify-between bg-gradient-to-br from-slate-50 via-white to-slate-100 p-4">
                <div className="flex items-center gap-2">
                    <span className="inline-flex rounded-md bg-slate-200 px-2 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-600">
                        {(ext || "file").slice(0, 4)}
                    </span>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-sm">
                    <p className="line-clamp-3 text-xs font-semibold leading-5 text-slate-700">
                        {doc.name}
                    </p>
                </div>
            </div>
        );
    };

    const filteredDocuments = storedDocuments.filter((doc) => {
        if (activeFilter === "all") return true;
        return doc.category === activeFilter;
    });

    const personalCount = storedDocuments.filter((doc) => doc.category === "personal").length;
    const companyCount = storedDocuments.filter((doc) => doc.category === "company").length;

    return (
        <div className="px-4 pb-8 pt-6 md:px-8 md:pb-10 md:pt-8">
            {/* Success Banner */}
            {showSaveSuccess && (
                <div className="mb-6 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 shadow-sm flex justify-between items-center transition-all animate-in fade-in slide-in-from-top-2">
                    <span className="flex items-center gap-2">
                        <Check className="h-4 w-4" />
                        Documents saved successfully!
                    </span>
                </div>
            )}

            {schemaError && (
                <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 shadow-sm">
                    {schemaError}
                </div>
            )}

            {/* Header with Upload Button */}
            <div className="mb-6 flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-semibold text-slate-900">My Documents</h1>
                    <p className="mt-1 text-sm text-slate-500">
                        Upload and store your documents, spreadsheets, presentations, and images
                    </p>
                </div>
                <button
                    type="button"
                    onClick={handleButtonClick}
                    disabled={isUploading || Boolean(schemaError)}
                    className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-5 py-2.5 text-xs font-semibold !text-white shadow-md hover:bg-violet-700 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isUploading ? (
                        <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Uploading...
                        </>
                    ) : (
                        <>
                            <CloudUpload className="h-4 w-4" />
                            Upload Document
                        </>
                    )}
                </button>
            </div>

            {/* Category Filter Tabs */}
            <div className="mb-6 flex flex-wrap gap-2">
                <button
                    onClick={() => setActiveFilter("all")}
                    className={`rounded-full px-5 py-1.5 text-xs font-semibold capitalize transition-all ${activeFilter === "all"
                        ? "bg-violet-600 text-white shadow-md shadow-violet-200"
                        : "bg-white border border-slate-200 text-slate-500 hover:border-violet-300 hover:text-violet-600 shadow-sm"
                        }`}
                >
                    All ({storedDocuments.length})
                </button>
                <button
                    onClick={() => setActiveFilter("personal")}
                    className={`rounded-full px-5 py-1.5 text-xs font-semibold capitalize transition-all ${activeFilter === "personal"
                        ? "bg-violet-600 text-white shadow-md shadow-violet-200"
                        : "bg-white border border-slate-200 text-slate-500 hover:border-violet-300 hover:text-violet-600 shadow-sm"
                        }`}
                >
                    <User className="inline h-3 w-3 mr-1" />
                    Personal ({personalCount})
                </button>
                <button
                    onClick={() => setActiveFilter("company")}
                    className={`rounded-full px-5 py-1.5 text-xs font-semibold capitalize transition-all ${activeFilter === "company"
                        ? "bg-violet-600 text-white shadow-md shadow-violet-200"
                        : "bg-white border border-slate-200 text-slate-500 hover:border-violet-300 hover:text-violet-600 shadow-sm"
                        }`}
                >
                    <Briefcase className="inline h-3 w-3 mr-1" />
                    Company ({companyCount})
                </button>
                <div className="ml-auto inline-flex items-center rounded-full border border-slate-200 bg-white p-1 shadow-sm">
                    <button
                        type="button"
                        onClick={() => setViewMode("list")}
                        className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition-all ${viewMode === "list" ? "bg-violet-600 text-white" : "text-slate-500 hover:bg-slate-100"}`}
                        aria-label="List view"
                    >
                        <List className="h-4 w-4" />
                    </button>
                    <button
                        type="button"
                        onClick={() => setViewMode("grid")}
                        className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition-all ${viewMode === "grid" ? "bg-violet-600 text-white" : "text-slate-500 hover:bg-slate-100"}`}
                        aria-label="Grid view"
                    >
                        <LayoutGrid className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {/* Empty State */}
            {filteredDocuments.length === 0 && (
                <div className="mt-10 rounded-3xl border border-slate-200 bg-white px-6 py-20 text-center shadow-sm">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 shadow-sm">
                        <Folder className="h-6 w-6 text-slate-600" />
                    </div>
                    <p className="mt-6 text-sm font-semibold text-slate-900">
                        No {activeFilter === 'personal' ? 'personal' : activeFilter === 'company' ? 'company' : ''} documents yet
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                        Use the upload button in the top right to add documents
                    </p>
                </div>
            )}

            {/* Documents Grid */}
            {filteredDocuments.length > 0 && viewMode === "grid" && (
                <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
                    {filteredDocuments.map((doc) => (
                        <div
                            key={doc.id}
                            className="group relative flex flex-col justify-between overflow-visible rounded-[1.6rem] border border-slate-200 bg-[#eef2f7] transition-all hover:border-slate-300 hover:shadow-md"
                        >
                            <div className="flex items-start justify-between gap-2 px-4 pb-3 pt-4">
                                <div className="flex items-start gap-3 min-w-0">
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm">
                                        {getFileIcon(doc.name)}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold text-slate-900" title={doc.name}>
                                            {doc.name}
                                        </p>
                                        <p className="text-xs text-slate-500">
                                            {formatFileSize(doc.size)}
                                        </p>
                                    </div>
                                </div>
                                <div className="relative menu-container">
                                    <button
                                        type="button"
                                        onClick={() => setOpenMenuId(openMenuId === doc.id ? null : doc.id)}
                                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-100 bg-white text-slate-400 hover:border-slate-200 hover:text-slate-600 transition-all active:scale-95"
                                        aria-label="More options"
                                    >
                                        <MoreHorizontal className="h-4 w-4" />
                                    </button>
                                    {openMenuId === doc.id && (
                                        <div className="absolute right-0 top-10 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[140px] overflow-visible">
                                            <button
                                                onClick={() => downloadDocument(doc)}
                                                className="flex items-center w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                                            >
                                                <Download size={16} className="mr-2" />
                                                Download
                                            </button>
                                            <button
                                                onClick={() => deleteDocument(doc.id)}
                                                className="flex items-center w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                                            >
                                                <Trash2 size={16} className="mr-2" />
                                                Delete
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="mx-4 h-40 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                                {getPreview(doc)}
                            </div>
                            <div className="mt-4 flex items-center gap-2 px-4">
                                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-500 text-xs font-semibold text-white">
                                    {doc.category === "personal" ? "P" : "C"}
                                </div>
                                <p className="truncate text-xs text-slate-600">
                                    You uploaded • {formatDate(doc.uploadedAt)}
                                </p>
                            </div>
                            <div className="mt-4 flex items-center justify-between border-t border-slate-200 bg-white/50 px-4 py-3">
                                <div className="flex items-center gap-2">
                                    {doc.category === "personal" ? (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-600">
                                            <User className="h-3 w-3" />
                                            Personal
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-600">
                                            <Briefcase className="h-3 w-3" />
                                            Company
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {filteredDocuments.length > 0 && viewMode === "list" && (
                <div className="space-y-3">
                    {filteredDocuments.map((doc) => (
                        <div key={doc.id} className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="flex h-16 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                                {getPreview(doc)}
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-3">
                                    <p className="truncate text-sm font-semibold text-slate-900">{doc.name}</p>
                                    {doc.category === "personal" ? (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-600">
                                            <User className="h-3 w-3" />
                                            Personal
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-600">
                                            <Briefcase className="h-3 w-3" />
                                            Company
                                        </span>
                                    )}
                                </div>
                                <p className="mt-1 text-xs text-slate-500">{formatFileSize(doc.size)}</p>
                                <p className="mt-2 text-xs text-slate-400">{formatDate(doc.uploadedAt)}</p>
                            </div>
                            <div className="relative menu-container">
                                <button
                                    type="button"
                                    onClick={() => setOpenMenuId(openMenuId === doc.id ? null : doc.id)}
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                                    aria-label="More options"
                                >
                                    <MoreHorizontal className="h-4 w-4" />
                                </button>
                                {openMenuId === doc.id && (
                                    <div className="absolute right-0 top-10 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[140px] overflow-visible">
                                        <button
                                            onClick={() => downloadDocument(doc)}
                                            className="flex items-center w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                                        >
                                            <Download size={16} className="mr-2" />
                                            Download
                                        </button>
                                        <button
                                            onClick={() => deleteDocument(doc.id)}
                                            className="flex items-center w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                                        >
                                            <Trash2 size={16} className="mr-2" />
                                            Delete
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Upload Type Selection Modal */}
            {showUploadModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl animate-in zoom-in-95 duration-200 relative">
                        <button
                            onClick={() => setShowUploadModal(false)}
                            className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all"
                        >
                            <X className="h-5 w-5" />
                        </button>
                        <div className="mb-6 text-center">
                            <h2 className="text-lg font-semibold text-slate-900">Select Document Type</h2>
                            <p className="mt-1 text-sm text-slate-500">Choose where you want to upload your document</p>
                        </div>
                        <div className="grid gap-4">
                            <button
                                onClick={() => handleUploadTypeSelect("personal")}
                                className="flex items-center gap-4 rounded-2xl border border-slate-200 p-4 text-left transition-all hover:border-blue-300 hover:bg-blue-50"
                            >
                                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-100">
                                    <User className="h-6 w-6 text-blue-600" />
                                </div>
                                <div>
                                    <p className="font-semibold text-slate-900">Personal Document</p>
                                    <p className="text-xs text-slate-500">For personal files and records</p>
                                </div>
                            </button>
                            <button
                                onClick={() => handleUploadTypeSelect("company")}
                                className="flex items-center gap-4 rounded-2xl border border-slate-200 p-4 text-left transition-all hover:border-green-300 hover:bg-green-50"
                            >
                                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-green-100">
                                    <Briefcase className="h-6 w-6 text-green-600" />
                                </div>
                                <div>
                                    <p className="font-semibold text-slate-900">Company Document</p>
                                    <p className="text-xs text-slate-500">For business and work files</p>
                                </div>
                            </button>
                        </div>
                    </div>
                </div>
            )}


            {/* Hidden File Input */}
            <input
                ref={inputRef}
                type="file"
                multiple
                accept="*"
                onChange={handleChange}
                className="hidden"
            />
        </div>
    );
}
