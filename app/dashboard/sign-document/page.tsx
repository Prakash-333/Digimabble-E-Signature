/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { RotateCw, CloudUpload, PenLine as Pen, Square, User, Mail, Building2, Tag, Type, CheckSquare, PenTool, X, Image as ImageIcon, Loader2, Calendar } from "lucide-react";
import { useUploadThing } from "../../lib/uploadthing-client";
import { deleteCloudFiles } from "../../actions/uploadthing";
import { supabase } from "../../lib/supabase/browser";
// Dynamic import for pdfjs-dist to avoid SSR issues with DOMMatrix
let pdfjsLib: typeof import("pdfjs-dist") | null = null;

const getPdfJs = async () => {
  if (!pdfjsLib) {
    pdfjsLib = await import("pdfjs-dist");
    if (typeof window !== "undefined") {
      pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
    }
  }
  return pdfjsLib;
};

type UploadedDoc = {
  id: string;
  name: string;
  type: string;
  sizeBytes: number;
  previewUrl?: string;
  key?: string;
};

type PlacedField = {
  id: string;
  type: "initial" | "stamp" | "name" | "first_name" | "last_name" | "email" | "company" | "title" | "text" | "checkbox" | "date";
  x: number;
  y: number;
  width: number;
  height: number;
  scale?: number;
  value?: string;
};

const DRAGGABLE_FIELDS = [
  { type: "initial", label: "Initial", icon: <span className="font-bold text-[10px] text-blue-600">DS</span> },
  { type: "stamp", label: "Stamp", icon: <Square className="h-4 w-4 text-slate-700" /> },
  { type: "name", label: "Name", icon: <User className="h-4 w-4 text-blue-500" /> },
  { type: "date", label: "Date", icon: <Calendar className="h-4 w-4 text-green-500" /> },
  { type: "first_name", label: "First Name", icon: <User className="h-4 w-4 text-blue-500" /> },
  { type: "last_name", label: "Last Name", icon: <User className="h-4 w-4 text-blue-500" /> },
  { type: "email", label: "Email Address", icon: <Mail className="h-4 w-4 text-blue-400" /> },
  { type: "company", label: "Company", icon: <Building2 className="h-4 w-4 text-slate-400" /> },
  { type: "title", label: "Title", icon: <Tag className="h-4 w-4 text-slate-400" /> },
  { type: "text", label: "Text", icon: <Type className="h-4 w-4 text-slate-400" /> },
  { type: "checkbox", label: "Checkbox", icon: <CheckSquare className="h-4 w-4 text-violet-600" /> },
] as const;

const formatBytes = (bytes: number) => {
  if (!bytes) return "Unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const ACCEPTED_INPUT =
  "application/pdf,image/*,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export default function SignDocumentPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewStageRef = useRef<HTMLDivElement | null>(null);
  const previewImgRef = useRef<HTMLImageElement | null>(null);
  const docsRef = useRef<UploadedDoc[]>([]);
  const [userId, setUserId] = useState<string | null>(null);

  // UploadThing hook for document uploads
  const { startUpload, isUploading: isUploadingToCloud } = useUploadThing("documentUploader", {
    onClientUploadComplete: async (res) => {
      if (res) {
        const newDocs: UploadedDoc[] = [];

        for (const file of res) {
          const isImage = file.type.startsWith("image/");
          const isPdf = file.type === "application/pdf";
          let previewUrl = isImage ? file.url : undefined;

          if (isPdf) {
            try {
              const pdfjs = await getPdfJs();
              const response = await fetch(file.url);
              const arrayBuffer = await response.arrayBuffer();
              const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
              const page = await pdf.getPage(1);
              const viewport = page.getViewport({ scale: 1.5 });
              const canvas = document.createElement("canvas");
              const ctx = canvas.getContext("2d");
              if (ctx) {
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                await page.render({ canvasContext: ctx, viewport, canvas: ctx.canvas }).promise;
                previewUrl = canvas.toDataURL("image/jpeg", 0.8);
              }
            } catch (e) { console.error("PDF preview error", e); }
          }

          newDocs.push({
            id: file.key,
            name: file.name,
            type: file.type,
            sizeBytes: file.size,
            previewUrl,
            key: file.key,
          });
        }
        setDocs((prev) => [...prev, ...newDocs]);
        const activeId = newDocs[0]?.id ?? null;
        setActiveDocId(prev => prev ?? activeId);

        // Auto-transition to signing view to show sidebar fields
        if (activeId) {
          setActiveDocId(activeId);
          setIsSigning(true);
        }
      }
    },
    onUploadError: (error) => {
      setBanner(`Upload failed: ${error.message}`);
    },
  });

  const { startUpload: uploadSigned, isUploading: isUploadingSigned } = useUploadThing("signedDocUploader", {
    onClientUploadComplete: async (res) => {
      if (res && res[0]) {
        const file = res[0];
        if (!userId) {
          setBanner("Please sign in again before saving a signed document.");
          return;
        }
        const newDoc = {
          id: `signed-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: activeDoc?.name || "Signed Document",
          subject: "Document signed via sign-now",
          recipients: [{ name: "Raj Kumar", email: "raj@smartdocs.in", role: "Signer" }],
          sender: { fullName: "Raj Kumar", workEmail: "raj@smartdocs.in" },
          sentAt: new Date().toISOString(),
          status: "signed",
          fileUrl: file.url, // Store the cloud URL
          fileKey: file.key, // Store the unique key for deletion
        };
        try {
          const { error } = await supabase.from("documents").insert({
            owner_id: userId,
            name: newDoc.name,
            subject: newDoc.subject,
            recipients: newDoc.recipients,
            sender: newDoc.sender,
            sent_at: newDoc.sentAt,
            status: newDoc.status,
            file_url: newDoc.fileUrl,
            file_key: newDoc.fileKey,
            category: null,
            content: null,
          });
          if (error) throw error;
          
          // Delete original source files from cloud since they are now processed?
          // The user said "same document should be delete on uploadthing dadtabase"
          // If they mean the original uploaded photo, we'll keep it for now unless they delete it from UI.
          
          setBanner("Document uploaded & signed! View in Shared Documents.");
          setTimeout(() => {
            setSignedPreview(null);
            setIsSigning(false);
          }, 2000);
        } catch (e) {
          setBanner("Failed to save document metadata.");
        }
      }
    },
    onUploadError: (error) => {
      setBanner(`Cloud upload failed: ${error.message}`);
    },
  });

  const [isDragActive, setIsDragActive] = useState(false);
  const [docs, setDocs] = useState<UploadedDoc[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);

  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const [isSigning, setIsSigning] = useState(false);
  const [signedPreview, setSignedPreview] = useState<string | null>(null);

  const [signatureX, setSignatureX] = useState(24);
  const [signatureY, setSignatureY] = useState(24);
  const [signatureScale, setSignatureScale] = useState(1);

  // Signature pad modal
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  const [signatureMode, setSignatureMode] = useState<"draw" | "type" | "upload">("draw");
  const [typedSignature, setTypedSignature] = useState("");
  const [uploadedSignature, setUploadedSignature] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  // Signature pad helper functions
  const getCanvasPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    let clientX: number, clientY: number;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    isDrawing.current = true;
    const pos = getCanvasPos(e);
    lastPos.current = pos;
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDrawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pos = getCanvasPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();
    lastPos.current = pos;
  };

  const handleMouseUp = () => {
    isDrawing.current = false;
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    e.preventDefault();
    isDrawing.current = true;
    const pos = getCanvasPos(e);
    lastPos.current = pos;
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    e.preventDefault();
    if (!isDrawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pos = getCanvasPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();
    lastPos.current = pos;
  };

  const handleTouchEnd = () => {
    isDrawing.current = false;
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      alert('File size must be less than 2MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      setUploadedSignature(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const saveSignature = () => {
    let signatureData: string;
    if (signatureMode === 'draw') {
      const canvas = canvasRef.current;
      if (!canvas) return;
      signatureData = canvas.toDataURL('image/png');
    } else if (signatureMode === 'type') {
      if (!typedSignature.trim()) {
        alert('Please enter your name');
        return;
      }
      // Create a canvas with the typed signature
      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 100;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.font = 'italic 36px cursive, serif';
      ctx.fillStyle = '#1e293b';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(typedSignature, canvas.width / 2, canvas.height / 2);
      signatureData = canvas.toDataURL('image/png');
    } else {
      if (!uploadedSignature) {
        alert('Please upload an image');
        return;
      }
      signatureData = uploadedSignature;
    }
    setSavedSignature(signatureData);
    if (userId) {
      void supabase.from("signatures").insert({
        owner_id: userId,
        name: "My signature",
        data_url: signatureData,
      });
    }
    setShowSignaturePad(false);
    setTypedSignature('');
    setUploadedSignature(null);
    clearCanvas();
  };

  // Draggable fields on document
  const [placedFields, setPlacedFields] = useState<PlacedField[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [draggingFieldType, setDraggingFieldType] = useState<PlacedField["type"] | null>(null);

  const dragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startSigX: number;
    startSigY: number;
  } | null>(null);

  useEffect(() => {
    const loadSignature = async () => {
      const { data } = await supabase.auth.getUser();
      const currentUser = data.user;
      if (!currentUser) return;
      setUserId(currentUser.id);

      const { data: row } = await supabase
        .from("signatures")
        .select("data_url")
        .eq("owner_id", currentUser.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (row?.data_url) {
        setSavedSignature(row.data_url);
      }
    };

    loadSignature();
  }, []);

  useEffect(() => {
    docsRef.current = docs;
  }, [docs]);

  useEffect(() => {
    return () => {
      docsRef.current.forEach((doc) => {
        if (doc.previewUrl && doc.previewUrl.startsWith('blob:')) URL.revokeObjectURL(doc.previewUrl);
      });
    };
  }, []);

  const addFiles = async (files: FileList) => {
    if (files.length > 0) {
      const fileArray = Array.from(files);
      await startUpload(fileArray);
    }
  };

  const activeDoc = useMemo(
    () => docs.find((doc) => doc.id === activeDocId) ?? docs[0] ?? null,
    [docs, activeDocId]
  );

  const hasDocs = docs.length > 0;
  const canSign = hasDocs && Boolean(savedSignature);

  const acceptedHint = useMemo(
    () => "PDFs and photos (JPG/PNG).",
    []
  );

  const isActiveDocImage = Boolean(activeDoc?.type?.startsWith("image/") || activeDoc?.previewUrl);
  const signatureWidthPx = Math.round(180 * signatureScale);
  const signatureHeightPx = Math.round(64 * signatureScale);

  const clampSignatureToStage = () => {
    const stage = previewStageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const maxX = Math.max(0, Math.floor(rect.width - signatureWidthPx));
    const maxY = Math.max(0, Math.floor(rect.height - signatureHeightPx));
    setSignatureX((x) => Math.min(Math.max(0, x), maxX));
    setSignatureY((y) => Math.min(Math.max(0, y), maxY));
  };

  useEffect(() => {
    if (!isSigning) return;
    const onResize = () => clampSignatureToStage();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSigning, signatureWidthPx, signatureHeightPx]);

  // Auto-place signature position when entering signing mode
  useEffect(() => {
    if (!isSigning) return;

    let attempts = 0;
    const tryPlace = () => {
      const stage = previewStageRef.current;
      if (stage) {
        const rect = stage.getBoundingClientRect();
        if (rect.width > 50 && rect.height > 50) {
          // Position signature at center-bottom of the document (where "Sincerely," would be)
          const defaultX = Math.max(40, Math.round((rect.width - signatureWidthPx) / 2));
          const defaultY = Math.max(40, Math.round(rect.height - 160));
          setSignatureX(defaultX);
          setSignatureY(defaultY);
          return;
        }
      }
      attempts++;
      if (attempts < 20) {
        setTimeout(tryPlace, 200);
      }
    };
    // Start trying after initial delay
    const timer = setTimeout(tryPlace, 300);

    return () => clearTimeout(timer);
  }, [isSigning, signatureWidthPx]);

  const startSigning = () => {
    if (!hasDocs) {
      setBanner("Upload at least one document to continue.");
      return;
    }
    // Allow starting signing without pre-saved signature - the signature will auto-place at placeholder
    // User can create signature after entering signing mode

    const picked = activeDoc ?? docs[0] ?? null;

    if (!picked || !picked.previewUrl) {
      setBanner(
        "Please upload a valid document or photo to continue."
      );
      return;
    }

    setActiveDocId(picked.id);
    setSignedPreview(null);
    setSignatureScale(1);
    setSignatureX(24);
    setSignatureY(24);
    setIsSigning(true);
    setBanner(null);

    // Scroll to the document preview area
    setTimeout(() => {
      window.scrollTo({ top: 400, behavior: "smooth" });
    }, 100);
  };

  const handleSignaturePointerDown = (event: React.PointerEvent) => {
    if (!isSigning) return;
    if (!savedSignature) return;
    if (!isActiveDocImage) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startSigX: signatureX,
      startSigY: signatureY,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const handleSignaturePointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const stage = previewStageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const dx = event.clientX - drag.startClientX;
    const dy = event.clientY - drag.startClientY;
    const maxX = Math.max(0, Math.floor(rect.width - signatureWidthPx));
    const maxY = Math.max(0, Math.floor(rect.height - signatureHeightPx));
    setSignatureX(
      Math.min(Math.max(0, Math.round(drag.startSigX + dx)), maxX)
    );
    setSignatureY(
      Math.min(Math.max(0, Math.round(drag.startSigY + dy)), maxY)
    );
  };

  const handleSignaturePointerUp = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    } catch (e) {
      // Pointer already released
    }
    dragRef.current = null;
  };

  // Signature resize via corner handle
  const sigResizeRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startScale: number;
  } | null>(null);

  const handleSigResizePointerDown = (event: React.PointerEvent) => {
    event.stopPropagation();
    event.preventDefault();
    sigResizeRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startScale: signatureScale,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const handleSigResizePointerMove = (event: React.PointerEvent) => {
    const resize = sigResizeRef.current;
    if (!resize) return;
    if (resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    const dx = event.clientX - resize.startClientX;
    const newScale = Math.min(2.5, Math.max(0.4, resize.startScale + dx / 180));
    setSignatureScale(newScale);
    setTimeout(() => clampSignatureToStage(), 0);
  };

  const handleSigResizePointerUp = (event: React.PointerEvent) => {
    const resize = sigResizeRef.current;
    if (!resize) return;
    if (resize.pointerId !== event.pointerId) return;
    sigResizeRef.current = null;
  };

  // Handle dropping a field onto the document
  const handleFieldDrop = (event: React.DragEvent, fieldType: PlacedField["type"]) => {
    event.preventDefault();
    const stage = previewStageRef.current;
    if (!stage) return;

    const rect = stage.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const fieldDefaults: Record<string, { width: number; height: number }> = {
      initial: { width: 84, height: 40 },
      stamp: { width: 120, height: 44 },
      name: { width: 150, height: 40 },
      date: { width: 120, height: 36 },
      first_name: { width: 150, height: 40 },
      last_name: { width: 150, height: 40 },
      email: { width: 150, height: 38 },
      company: { width: 150, height: 38 },
      title: { width: 150, height: 38 },
      text: { width: 150, height: 40 },
      checkbox: { width: 44, height: 44 },
    };

    const newField: PlacedField = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: fieldType,
      x: Math.max(0, x - fieldDefaults[fieldType].width / 2),
      y: Math.max(0, y - fieldDefaults[fieldType].height / 2),
      width: fieldDefaults[fieldType].width,
      height: fieldDefaults[fieldType].height,
      scale: 1,
      value: fieldType === "checkbox" ? "" : fieldType === "date" ? new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }) : DRAGGABLE_FIELDS.find(f => f.type === fieldType)?.label || "",
    };

    setPlacedFields((prev) => [...prev, newField]);
    setDraggingFieldType(null);
  };

  // Handle dragging a placed field
  const handlePlacedFieldDrag = (fieldId: string, dx: number, dy: number, stageRect: DOMRect) => {
    setPlacedFields((prev) =>
      prev.map((field) => {
        if (field.id !== fieldId) return field;
        const newX = Math.max(0, Math.min(field.x + dx, stageRect.width - field.width));
        const newY = Math.max(0, Math.min(field.y + dy, stageRect.height - field.height));
        return { ...field, x: newX, y: newY };
      })
    );
  };

  // Pointer state for dragging placed fields
  const placedFieldDragRef = useRef<{
    fieldId: string;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startFieldX: number;
    startFieldY: number;
  } | null>(null);

  const handlePlacedFieldPointerDown = (fieldId: string, event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedFieldId(fieldId);
    const field = placedFields.find(f => f.id === fieldId);
    if (!field) return;

    placedFieldDragRef.current = {
      fieldId,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startFieldX: field.x,
      startFieldY: field.y,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const handlePlacedFieldPointerMove = (event: React.PointerEvent) => {
    const drag = placedFieldDragRef.current;
    if (!drag) return;
    if (drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();

    const stage = previewStageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const dx = event.clientX - drag.startClientX;
    const dy = event.clientY - drag.startClientY;

    handlePlacedFieldDrag(drag.fieldId, dx, dy, rect);

    drag.startClientX = event.clientX;
    drag.startClientY = event.clientY;
  };

  const handlePlacedFieldPointerUp = (event: React.PointerEvent) => {
    const drag = placedFieldDragRef.current;
    if (!drag) return;
    if (drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    } catch (e) {
      // Pointer already released
    }
    placedFieldDragRef.current = null;
  };

  // Resize state for placed fields
  const fieldResizeRef = useRef<{
    fieldId: string;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);

  const handleFieldResizePointerDown = (fieldId: string, event: React.PointerEvent) => {
    event.stopPropagation();
    const field = placedFields.find(f => f.id === fieldId);
    if (!field) return;

    fieldResizeRef.current = {
      fieldId,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWidth: field.width,
      startHeight: field.height,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const handleFieldResizePointerMove = (event: React.PointerEvent) => {
    const resize = fieldResizeRef.current;
    if (!resize) return;
    if (resize.pointerId !== event.pointerId) return;

    const dx = event.clientX - resize.startClientX;
    const dy = event.clientY - resize.startClientY;
    const newWidth = Math.max(30, resize.startWidth + dx);
    const newHeight = Math.max(20, resize.startHeight + dy);

    setPlacedFields((prev) =>
      prev.map((field) => {
        if (field.id !== resize.fieldId) return field;
        return { ...field, width: newWidth, height: newHeight };
      })
    );
  };

  const handleFieldResizePointerUp = (event: React.PointerEvent) => {
    const resize = fieldResizeRef.current;
    if (!resize) return;
    if (resize.pointerId !== event.pointerId) return;
    fieldResizeRef.current = null;
  };

  // Delete a placed field
  const deleteField = (fieldId: string) => {
    setPlacedFields((prev) => prev.filter((f) => f.id !== fieldId));
  };

  const saveSignedImage = async () => {
    if (!savedSignature) {
      setBanner("No signature found. Create one first.");
      return;
    }
    if (!activeDoc || !activeDoc.previewUrl) {
      setBanner("Upload or select a valid document to save a signed copy.");
      return;
    }

    const imgEl = previewImgRef.current;
    const stageEl = previewStageRef.current;
    if (!imgEl || !stageEl) {
      setBanner("Preview not ready yet. Try again.");
      return;
    }

    const renderWidth = stageEl.clientWidth;
    const renderHeight = stageEl.clientHeight;
    const naturalWidth = imgEl.naturalWidth || renderWidth;
    const naturalHeight = imgEl.naturalHeight || renderHeight;

    if (!renderWidth || !renderHeight) {
      setBanner("Preview not ready yet. Try again.");
      return;
    }

    const scaleX = naturalWidth / renderWidth;
    const scaleY = naturalHeight / renderHeight;

    const baseImage = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Failed to load base image"));
      image.src = activeDoc.previewUrl!;
    });

    const sigImage = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Failed to load signature"));
      image.src = savedSignature;
    });

    const canvas = document.createElement("canvas");
    canvas.width = naturalWidth;
    canvas.height = naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setBanner("Canvas not supported in this browser.");
      return;
    }

    ctx.drawImage(baseImage, 0, 0, naturalWidth, naturalHeight);

    // Draw signature at the dragged position only
    if (savedSignature) {
      const sigX = Math.round(signatureX * scaleX);
      const sigY = Math.round(signatureY * scaleY);
      const sigW = Math.round(signatureWidthPx * scaleX);
      const sigH = Math.round(signatureHeightPx * scaleY);
      ctx.drawImage(sigImage, sigX, sigY, sigW, sigH);
    }

    // Draw placed fields (date, name, text, etc.)
    for (const field of placedFields) {
      const fieldX = Math.round(field.x * scaleX);
      const fieldY = Math.round(field.y * scaleY);
      const fieldW = Math.round(field.width * scaleX);
      const fieldH = Math.round(field.height * scaleY);

      if (field.type === "checkbox") {
        ctx.strokeStyle = "#64748b";
        ctx.lineWidth = 2;
        ctx.strokeRect(fieldX, fieldY, fieldW, fieldH);
        if (field.value === "checked") {
          ctx.fillStyle = "#7c3aed";
          const pad = fieldW * 0.25;
          ctx.fillRect(fieldX + pad, fieldY + pad, fieldW - pad * 2, fieldH - pad * 2);
        }
      } else {
        const text = field.value || field.type;
        const fontSize = Math.max(12, Math.round(fieldH * 0.5));
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.fillStyle = "#1e293b";
        ctx.textBaseline = "middle";
        ctx.fillText(text, fieldX + 4, fieldY + fieldH / 2);
      }
    }

    const dataUrl = canvas.toDataURL("image/png");
    setSignedPreview(dataUrl);
    setIsSigning(false);
    setBanner("Saved signed copy (demo). Download it below.");
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {isSigning ? (
        <div className="flex min-h-[calc(100vh-120px)] flex-col -mx-4 -mt-4 md:-mx-8 md:-mt-4">
          {/* Sticky Dark Header */}
          <header className="sticky top-0 z-30 flex items-center justify-between gap-3 bg-slate-900 border-b border-slate-800 px-4 py-3 text-white md:px-6 shadow-xl">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500 shadow-lg overflow-hidden">
                {activeDoc?.previewUrl ? (
                  <img src={activeDoc.previewUrl} alt="Preview" className="h-full w-full object-cover" />
                ) : (
                  <Pen className="h-5 w-5 text-white" />
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold tracking-tight text-white hover:text-violet-200 transition-colors cursor-default">
                  {activeDoc?.name || "Sign Document"}
                </p>
                <div className="flex items-center gap-2">
                  <p className="text-[10px] font-medium text-violet-300/80 uppercase tracking-widest">Self Signing Mode</p>
                  <span className="h-1 w-1 rounded-full bg-violet-400/50" />
                  <p className="text-[10px] font-medium text-violet-300/80 uppercase tracking-widest">{activeDoc?.type?.split('/')[1] || "DOC"}</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-full border border-white/20 bg-white/5 px-5 py-2 text-xs font-semibold text-white hover:bg-white/10 transition-all active:scale-95"
                onClick={() => {
                  setIsSigning(false);
                  setBanner(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-full bg-violet-600 px-6 py-2 text-xs font-bold text-white shadow-lg shadow-violet-900/20 hover:bg-violet-500 transition-all active:scale-95"
                onClick={saveSignedImage}
              >
                Save
              </button>
            </div>
          </header>

          <div className="flex flex-1 overflow-hidden bg-slate-100" style={{ height: 'calc(100vh - 120px)' }}>
            {/* Left Sidebar: Draggable Fields */}
            <aside className="w-72 flex-shrink-0 border-r border-slate-200 bg-white shadow-sm overflow-y-auto hidden md:block">
              <div className="px-6 py-6 border-b border-slate-50">
                <p className="text-[11px] font-bold tracking-[0.2em] text-slate-500 uppercase">Fields</p>
              </div>
              <div className="space-y-6 px-4 py-6">
                <div className="space-y-1.5">
                  {DRAGGABLE_FIELDS.slice(0, 4).map((field) => (
                    <div
                      key={field.type}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("fieldType", field.type);
                        setDraggingFieldType(field.type);
                      }}
                      onDragEnd={() => setDraggingFieldType(null)}
                      className={`flex cursor-grab items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-violet-50 hover:text-violet-700 transition-all active:cursor-grabbing group ${draggingFieldType === field.type ? "opacity-40" : ""}`}
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-50 group-hover:bg-white border border-transparent group-hover:border-violet-100 shadow-sm transition-all">
                        {field.icon}
                      </span>
                      <span>{field.label}</span>
                    </div>
                  ))}
                </div>

                <div className="h-px bg-slate-100 mx-4" />

                <div className="space-y-1.5">
                  {DRAGGABLE_FIELDS.slice(4).map((field) => (
                    <div
                      key={field.type}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("fieldType", field.type);
                        setDraggingFieldType(field.type);
                      }}
                      onDragEnd={() => setDraggingFieldType(null)}
                      className={`flex cursor-grab items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-violet-50 hover:text-violet-700 transition-all active:cursor-grabbing group ${draggingFieldType === field.type ? "opacity-40" : ""}`}
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-50 group-hover:bg-white border border-transparent group-hover:border-violet-100 shadow-sm transition-all">
                        {field.icon}
                      </span>
                      <span>{field.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </aside>

            {/* Center Area: Document Canvas */}
            <main className="flex-1 flex flex-col overflow-hidden relative">
              <div className="flex-1 overflow-auto p-8 md:p-12 lg:p-16 flex items-start justify-center">
                <div
                  ref={previewStageRef}
                  className="relative bg-white shadow-[0_20px_50px_rgba(0,0,0,0.1)] rounded-sm overflow-hidden select-none transition-all border border-slate-200"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    const fieldType = e.dataTransfer.getData("fieldType") as PlacedField["type"];
                    if (fieldType) handleFieldDrop(e, fieldType);
                  }}
                >
                  {activeDoc?.previewUrl ? (
                    <img
                      ref={previewImgRef}
                      src={activeDoc.previewUrl}
                      alt={activeDoc.name}
                      crossOrigin="anonymous"
                      className="max-h-[85vh] w-auto pointer-events-none"
                      onLoad={() => {
                        // Re-position signature after image loads
                        setTimeout(() => {
                          clampSignatureToStage();
                          const stage = previewStageRef.current;
                          if (stage) {
                            const rect = stage.getBoundingClientRect();
                            if (rect.width > 50 && rect.height > 50) {
                              setSignatureX(Math.max(40, Math.round((rect.width - signatureWidthPx) / 2)));
                              setSignatureY(Math.max(40, Math.round(rect.height - 160)));
                            }
                          }
                        }, 100);
                      }}
                    />
                  ) : (
                    <div className="h-[600px] w-[500px] bg-slate-50 flex items-center justify-center">
                      <p className="text-slate-400 font-medium">No document preview available</p>
                    </div>
                  )}

                  {/* Signature Area */}
                  {savedSignature ? (
                    <div
                      className="absolute cursor-grab group active:cursor-grabbing z-10 rounded-lg border border-dashed border-violet-300 hover:border-violet-500 hover:bg-violet-50/30 transition-all"
                      style={{
                        transform: `translate(${signatureX}px, ${signatureY}px)`,
                        width: `${signatureWidthPx}px`,
                        height: `${signatureHeightPx}px`,
                        touchAction: 'none',
                        userSelect: 'none',
                      }}
                      onPointerDown={handleSignaturePointerDown}
                      onPointerMove={handleSignaturePointerMove}
                      onPointerUp={handleSignaturePointerUp}
                      onPointerCancel={handleSignaturePointerUp}
                    >
                      <div className="relative h-full w-full">
                        <img
                          src={savedSignature}
                          alt="Signature"
                          className="h-full w-full object-contain pointer-events-none select-none"
                          style={{ border: 'none', outline: 'none' }}
                          draggable={false}
                        />
                        {/* Close button */}
                        <button
                          type="button"
                          className="absolute -right-2 -top-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 border border-white text-[10px] text-white shadow-xl hover:bg-red-600 transition-transform active:scale-90 z-20"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSavedSignature(null);
                          }}
                        >
                          ✕
                        </button>
                        {/* Resize handle */}
                        <div
                          className="absolute right-0 bottom-0 w-5 h-5 cursor-se-resize flex items-end justify-end z-20"
                          onPointerDown={handleSigResizePointerDown}
                          onPointerMove={handleSigResizePointerMove}
                          onPointerUp={handleSigResizePointerUp}
                          onPointerCancel={handleSigResizePointerUp}
                        >
                          <svg className="w-3.5 h-3.5 text-slate-400 group-hover:text-violet-500 transition-colors" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M22 22H20V20H22V22ZM22 18H20V16H22V18ZM18 22H16V20H18V22ZM22 14H20V12H22V14ZM18 18H16V16H18V18ZM14 22H12V20H14V22Z" />
                          </svg>
                        </div>
                        {/* Drag hint label */}
                        <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[8px] font-bold text-violet-500 uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity">
                          Drag to move
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Signature Placeholder - draggable + click to create */
                    <div
                      className="absolute cursor-grab active:cursor-grabbing z-10 group"
                      style={{
                        transform: `translate(${signatureX}px, ${signatureY}px)`,
                        width: `${signatureWidthPx}px`,
                        height: `${signatureHeightPx}px`,
                        touchAction: 'none',
                        userSelect: 'none',
                      }}
                      onPointerDown={(e) => {
                        const stage = previewStageRef.current;
                        if (!stage) return;
                        e.preventDefault();
                        e.stopPropagation();
                        const startX = e.clientX;
                        const startY = e.clientY;
                        const origX = signatureX;
                        const origY = signatureY;
                        let moved = false;
                        const onMove = (ev: PointerEvent) => {
                          const dx = ev.clientX - startX;
                          const dy = ev.clientY - startY;
                          if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
                          const rect = stage.getBoundingClientRect();
                          const maxX = Math.max(0, Math.floor(rect.width - signatureWidthPx));
                          const maxY = Math.max(0, Math.floor(rect.height - signatureHeightPx));
                          setSignatureX(Math.min(Math.max(0, Math.round(origX + dx)), maxX));
                          setSignatureY(Math.min(Math.max(0, Math.round(origY + dy)), maxY));
                        };
                        const onUp = () => {
                          window.removeEventListener("pointermove", onMove);
                          window.removeEventListener("pointerup", onUp);
                          if (!moved) setShowSignaturePad(true);
                        };
                        window.addEventListener("pointermove", onMove);
                        window.addEventListener("pointerup", onUp);
                      }}
                    >
                      <div className="relative h-full w-full flex items-center justify-center rounded-lg border-2 border-dashed border-violet-400 bg-violet-50/60 hover:bg-violet-100/80 hover:border-violet-500 transition-all">
                        <div className="flex flex-col items-center gap-1">
                          <Pen className="h-5 w-5 text-violet-500 group-hover:text-violet-600 transition-colors" />
                          <span className="text-[9px] font-bold text-violet-600 uppercase tracking-wider">Add Signature</span>
                          <span className="text-[7px] text-violet-400 font-medium">Click or Drag</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Placed Fields */}
                  {placedFields.map((field) => {
                    const isSelected = field.id === selectedFieldId;
                    return (
                      <div
                        key={field.id}
                        className={
                          "absolute cursor-move group transition-all " +
                          (isSelected
                            ? "ring-2 ring-violet-500 border-transparent bg-violet-50/30 z-20"
                            : "bg-transparent z-10")
                        }
                        style={{
                          left: field.x,
                          top: field.y,
                          width: field.width,
                          height: field.height,
                          transform: `scale(${field.scale || 1})`,
                          transformOrigin: "top left",
                          touchAction: 'none',
                          userSelect: 'none',
                        }}
                        onPointerDown={(e) => handlePlacedFieldPointerDown(field.id, e)}
                        onPointerMove={(e) => handlePlacedFieldPointerMove(e)}
                        onPointerUp={(e) => handlePlacedFieldPointerUp(e)}
                        onPointerCancel={(e) => handlePlacedFieldPointerUp(e)}
                      >
                        <div className="relative flex h-full w-full items-center justify-center px-2 py-1">
                          {field.type === "checkbox" ? (
                            <div className="h-4 w-4 border-2 border-slate-400 rounded bg-white flex items-center justify-center">
                              {field.value === "checked" && <div className="h-2 w-2 bg-violet-600 rounded-sm" />}
                            </div>
                          ) : field.type === "date" ? (
                            <span className="text-[10px] font-bold text-slate-700">{field.value || new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" })}</span>
                          ) : (
                            <span className="text-[10px] font-bold text-slate-700 truncate">{field.value}</span>
                          )}

                          {isSelected && (
                            <>
                              {/* Resize handle */}
                              <div
                                className="absolute right-0 bottom-0 w-4 h-4 cursor-se-resize flex items-end justify-end"
                                onPointerDown={(e) => handleFieldResizePointerDown(field.id, e)}
                                onPointerMove={(e) => handleFieldResizePointerMove(e)}
                                onPointerUp={(e) => handleFieldResizePointerUp(e)}
                                onPointerCancel={(e) => handleFieldResizePointerUp(e)}
                              >
                                <svg className="w-3 h-3 text-violet-500" viewBox="0 0 24 24" fill="currentColor">
                                  <path d="M22 22H20V20H22V22ZM22 18H20V16H22V18ZM18 22H16V20H18V22ZM22 14H20V12H22V14ZM18 18H16V16H18V18ZM14 22H12V20H14V22Z" />
                                </svg>
                              </div>
                              {/* Delete button */}
                              <button
                                type="button"
                                className="absolute -right-2 -top-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 border border-white text-[10px] text-white shadow-xl hover:bg-black transition-transform active:scale-90 z-20"
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteField(field.id);
                                }}
                              >
                                ✕
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Floating Zoom Controls & Signature Controls */}
              <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-4 px-6 py-2 bg-white/90 backdrop-blur-md rounded-full shadow-2xl border border-slate-200 z-40">
              </div>
            </main>

            {/* Right Sidebar: Quick Actions */}
            <aside className="w-16 flex-shrink-0 border-l border-slate-200 bg-white hidden lg:flex flex-col items-center py-8 gap-8">
              <button title="Summarize" className="flex flex-col items-center gap-1.5 text-slate-400 hover:text-violet-600 transition-colors">
                <span className="text-xl">✦</span>
                <span className="text-[9px] font-bold uppercase tracking-tighter">Sum</span>
              </button>
              <button title="Search" className="flex flex-col items-center gap-1.5 text-slate-400 hover:text-violet-600 transition-colors text-lg">🔎</button>
              <button title="Download" className="flex flex-col items-center gap-1.5 text-slate-400 hover:text-violet-600 transition-colors text-lg">⬇</button>
              <div className="mt-auto flex flex-col items-center gap-3">
                <div className="h-10 w-10 rounded-full border-2 border-violet-100 p-0.5">
                  <div className="h-full w-full rounded-full bg-violet-500 flex items-center justify-center text-[10px] font-bold text-white shadow-inner">RK</div>
                </div>
              </div>
            </aside>
          </div>
        </div>
      ) : (
        <div className="px-4 pb-10 pt-2 md:px-8 md:pt-4">
          <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
            <section id="document-preview" className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-4 border-b border-slate-100 pb-6 md:flex-row md:items-start md:justify-between">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight text-slate-900">Sign Document</h1>
                  <p className="mt-1 text-sm text-slate-600">
                    Upload a document and apply your signature (demo).
                  </p>
                </div>
              </div>

              {banner && (
                <div className="animate-in fade-in slide-in-from-top-2 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-700 shadow-sm flex items-center gap-3">
                  <div className="h-2 w-2 rounded-full bg-violet-500 animate-pulse" />
                  {banner}
                </div>
              )}

              {signedPreview ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold text-slate-900">Signed Document Preview</p>
                      <p className="text-[11px] text-slate-500 uppercase tracking-tighter">Ready for download</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href={signedPreview}
                        download={`signed-${activeDoc?.name?.replace(/\s+/g, "-") || "document"}.png`}
                        className="rounded-full border border-violet-600 bg-white px-4 py-2 text-xs font-bold text-violet-600 shadow-sm hover:bg-violet-600 hover:text-white transition-all active:scale-95"
                      >
                        Download PNG
                      </a>
                      <button
                        type="button"
                        disabled={isUploadingSigned}
                        onClick={async () => {
                          if (!signedPreview) return;
                          
                          setBanner("Uploading to cloud...");
                          try {
                            // Convert dataUrl to File
                            const response = await fetch(signedPreview);
                            const blob = await response.blob();
                            const filename = `signed-${activeDoc?.name?.replace(/\s+/g, "-") || "document"}.png`;
                            const file = new File([blob], filename, { type: "image/png" });
                            
                            await uploadSigned([file]);
                          } catch (e) {
                            console.error("Upload preparation failed", e);
                            setBanner("Failed to prepare file for upload.");
                          }
                        }}
                        className="rounded-full bg-green-600 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-green-900/20 hover:bg-green-700 transition-all active:scale-95 flex items-center gap-2"
                      >
                        {isUploadingSigned ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Finalizing...
                          </>
                        ) : (
                          "Finish & Close"
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-inner">
                    <img src={signedPreview} alt="Signed" className="mx-auto max-h-[600px] w-auto rounded-lg shadow-2xl border border-white" />
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between pt-4">
                    <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">Upload Area</p>
                  </div>

                  <div
                    className={
                      "group relative rounded-2xl border-2 border-dashed bg-white px-6 py-12 text-center transition-all " +
                      (isDragActive ? "border-violet-500 bg-violet-50 scale-[0.99]" : "border-slate-200 hover:border-violet-300 hover:bg-slate-50/50")
                    }
                    onDragOver={(e) => { e.preventDefault(); setIsDragActive(true); }}
                    onDragLeave={() => setIsDragActive(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDragActive(false);
                      if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
                    }}
                  >
                    {isUploadingToCloud ? (
                      <div className="flex flex-col items-center justify-center space-y-4 py-4">
                        <div className="relative">
                          <div className="h-16 w-16 rounded-full border-4 border-violet-100 border-t-violet-600 animate-spin"></div>
                          <div className="absolute inset-0 flex items-center justify-center">
                            <CloudUpload className="h-6 w-6 text-violet-600" />
                          </div>
                        </div>
                        <div className="text-center">
                          <p className="text-base font-bold text-slate-900">Uploading...</p>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-100 text-violet-600 shadow-sm transition-transform group-hover:scale-110">
                          <CloudUpload className="h-7 w-7" />
                        </div>
                        <p className="mt-5 text-base font-bold text-slate-900">Choose a file or drag it here</p>
                        <p className="mt-1 text-xs text-slate-500 font-medium tracking-tight">Accepts {acceptedHint}</p>
                        <div className="mt-6">
                          <button
                            type="button"
                            className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-7 py-3 text-sm font-bold text-white shadow-xl shadow-violet-900/20 hover:bg-violet-700 transition-all active:scale-95"
                            onClick={() => fileInputRef.current?.click()}
                          >
                            Browse Files
                          </button>
                        </div>
                      </>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={ACCEPTED_INPUT}
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files?.length) addFiles(e.target.files);
                      }}
                    />
                  </div>

                  {docs.length > 0 && (
                    <div className="space-y-4">
                      <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">Queue ({docs.length})</p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {docs.map((doc) => (
                          <div
                            key={doc.id}
                            className={
                              "group flex items-center justify-between gap-3 rounded-2xl border p-3 transition-all cursor-pointer " +
                              (doc.id === activeDocId ? "border-violet-300 bg-violet-50 ring-1 ring-violet-200" : "border-slate-100 bg-white hover:border-violet-200 shadow-sm")
                            }
                            onClick={() => setActiveDocId(doc.id)}
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-50 border border-slate-100 shadow-inner">
                                {doc.previewUrl ? <img src={doc.previewUrl} className="h-full w-full object-cover" /> : <div className="text-[10px] font-black text-slate-400">{doc.type.split('/')[1].toUpperCase()}</div>}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-bold text-slate-800">{doc.name}</p>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">{formatBytes(doc.sizeBytes)}</p>
                              </div>
                            </div>
                            <button
                              type="button"
                              className="h-8 w-8 rounded-full flex items-center justify-center text-slate-300 hover:bg-red-50 hover:text-red-500 transition-colors"
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (doc.key) {
                                  await deleteCloudFiles(doc.key);
                                }
                                setDocs(prev => prev.filter(d => d.id !== doc.id));
                                if (activeDocId === doc.id) setActiveDocId(null);
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </section>

            <aside className="space-y-6">
              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">My Signature</p>
                </div>
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 p-1">
                  {savedSignature ? (
                    <div className="rounded-xl bg-white p-6 shadow-inner flex items-center justify-center h-40 group relative overflow-hidden">
                      <img src={savedSignature} alt="My signature" className="max-h-full max-w-full object-contain transition-transform group-hover:scale-105" />
                      <div className="absolute inset-x-0 bottom-0 py-2 bg-slate-900/5 backdrop-blur-sm transform translate-y-full group-hover:translate-y-0 transition-transform flex justify-center uppercase text-[9px] font-black text-slate-500 tracking-widest">Permanent saved ID</div>
                    </div>
                  ) : (
                    <div className="text-center py-10 px-4">
                      <p className="text-xs text-slate-400 font-medium mb-5 italic">No signature found.</p>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setShowSignaturePad(true)}
                  className="mt-3 inline-flex w-full items-center justify-center rounded-full border border-violet-600 bg-white px-4 py-2 text-xs font-semibold text-violet-600 shadow-sm hover:bg-violet-600 hover:text-white transition-all active:scale-95"
                >
                  {savedSignature ? (
                    <>
                      <PenTool className="mr-2 h-3.5 w-3.5" />
                      Replace
                    </>
                  ) : (
                    <>
                      <PenTool className="mr-2 h-3.5 w-3.5" />
                      Add Signature
                    </>
                  )}
                </button>
              </section>

            </aside>
          </div>
        </div>
      )}

      {/* Signature Pad Modal */}
      {showSignaturePad && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h3 className="text-lg font-bold text-slate-800">Create Signature</h3>
              <button
                onClick={() => setShowSignaturePad(false)}
                className="ml-auto rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Mode Tabs */}
            <div className="flex border-b border-slate-100">
              <button
                onClick={() => setSignatureMode("draw")}
                className={`flex-1 py-3 text-sm font-semibold transition-colors ${signatureMode === "draw"
                  ? "text-violet-600 border-b-2 border-violet-600"
                  : "text-slate-500 hover:text-slate-700"
                  }`}
              >
                <PenTool className="inline-block h-4 w-4 mr-2" />
                Draw
              </button>
              <button
                onClick={() => setSignatureMode("type")}
                className={`flex-1 py-3 text-sm font-semibold transition-colors ${signatureMode === "type"
                  ? "text-violet-600 border-b-2 border-violet-600"
                  : "text-slate-500 hover:text-slate-700"
                  }`}
              >
                <Type className="inline-block h-4 w-4 mr-2" />
                Type
              </button>
              <button
                onClick={() => setSignatureMode("upload")}
                className={`flex-1 py-3 text-sm font-semibold transition-colors ${signatureMode === "upload"
                  ? "text-violet-600 border-b-2 border-violet-600"
                  : "text-slate-500 hover:text-slate-700"
                  }`}
              >
                <ImageIcon className="inline-block h-4 w-4 mr-2" />
                Upload
              </button>
            </div>

            {/* Mode Content */}
            <div className="p-6">
              {signatureMode === "draw" && (
                <div className="relative">
                  <canvas
                    ref={canvasRef}
                    width={400}
                    height={200}
                    className="w-full rounded-xl border border-slate-200 bg-white cursor-crosshair"
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                  />
                </div>
              )}

              {signatureMode === "type" && (
                <div className="space-y-4">
                  <input
                    type="text"
                    value={typedSignature}
                    onChange={(e) => setTypedSignature(e.target.value)}
                    placeholder="Type your name"
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 text-lg font-serif focus:border-violet-300 focus:outline-none focus:ring-2 focus:ring-violet-100"
                  />
                  {typedSignature && (
                    <div className="rounded-xl border border-slate-100 bg-slate-50 p-8 text-center">
                      <p
                        className="text-4xl font-serif text-slate-800 italic"
                        style={{ fontFamily: 'cursive, sans-serif' }}
                      >
                        {typedSignature}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {signatureMode === "upload" && (
                <div className="space-y-4">
                  <label className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 p-8 cursor-pointer hover:bg-slate-100 hover:border-violet-300 transition-colors">
                    <CloudUpload className="h-10 w-10 text-slate-400 mb-3" />
                    <span className="text-sm font-medium text-slate-600">Click to upload signature image</span>
                    <span className="text-xs text-slate-400 mt-1">PNG, JPG up to 2MB</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg"
                      onChange={handleImageUpload}
                      className="hidden"
                    />
                  </label>
                  {uploadedSignature && (
                    <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 text-center">
                      <img src={uploadedSignature} alt="Uploaded" className="max-h-32 mx-auto object-contain" />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3 border-t border-slate-100 px-6 py-4">
              <button
                onClick={() => setShowSignaturePad(false)}
                className="flex-1 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveSignature}
                className="flex-1 rounded-full bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 shadow-md shadow-violet-200 transition-all hover:shadow-lg"
              >
                Save Signature
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
