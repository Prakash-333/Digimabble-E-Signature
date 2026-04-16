"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { CheckCircle2, Loader2, FileText, PenLine as Pen, Lock, ShieldCheck, AlertCircle, Clock, X, RotateCcw, Edit3, Save, Eye as EyeIcon, RotateCw, PenTool } from "lucide-react";
import { getGuestDocumentMetaData, markFirstLogin, submitGuestSignature } from "../../actions/document-guest";
import { highlightHtmlEdits, saveSelection, restoreSelection, stripHighlights } from "../../lib/diff";
import { supabase } from "../../lib/supabase/browser";
import { normalizeEmail } from "../../lib/documents";

interface DocumentData {
  id: string;
  name: string;
  category?: string;
  status: string;
  content?: string;
  file_url?: string;
  access_id?: string;
  access_password?: string;
  access_first_login?: string | null;
  recipients?: Array<{ email: string; name: string }>;
}

interface ResizableWrapperProps {
  x: number;
  y: number;
  width: number;
  height: number;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onResizeStart: (e: React.PointerEvent) => void;
  onDragStart: (e: React.PointerEvent) => void;
  children: React.ReactNode;
}

const ResizableWrapper = ({
  x,
  y,
  width,
  height,
  isSelected,
  onSelect,
  onDelete,
  onResizeStart,
  onDragStart,
  children,
}: ResizableWrapperProps) => {
  return (
    <div
      className={`absolute rounded-md border-2 border-dashed group flex items-center justify-center cursor-grab active:cursor-grabbing select-none transition-all ${
        isSelected ? "border-violet-500 bg-violet-50/50" : "border-slate-400 hover:border-violet-400"
      }`}
      style={{
        left: `${x}px`,
        top: `${y}px`,
        width: `${width}px`,
        height: `${height}px`,
        zIndex: 100,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onPointerDown={onDragStart}
    >
      {children}
      {/* Delete button (Top-right) */}
      <button
        type="button"
        className="absolute -right-2 -top-2 h-5 w-5 rounded-full bg-red-500 border border-white text-white shadow flex items-center justify-center hover:bg-red-600 transition-all active:scale-90 opacity-0 group-hover:opacity-100"
        style={{ zIndex: 110 }}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <X className="h-2.5 w-2.5" />
      </button>

      {/* Resize handle (Bottom-right) */}
      <div
        className="absolute -right-2 -bottom-2 w-5 h-5 cursor-nwse-resize bg-violet-600 rounded-full shadow-md hover:bg-violet-500 transition-all border-2 border-white flex items-center justify-center"
        style={{ zIndex: 110 }}
        onPointerDown={onResizeStart}
      >
        <svg
          className="w-2.5 h-2.5 text-white"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M22 22L12 22L22 12Z" fill="currentColor" />
        </svg>
      </div>
    </div>
  );
};

export default function PublicSignPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [document, setDocument] = useState<DocumentData | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Login State
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [accessIdInput, setAccessIdInput] = useState("");
  const [accessPasswordInput, setAccessPasswordInput] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Signing State
  const [showSignModal, setShowSignModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSigned, setIsSigned] = useState(false);
  const [signMessage, setSignMessage] = useState("");
  
  // Drag and Drop Signature State
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const [signatureX, setSignatureX] = useState(50);
  const [signatureY, setSignatureY] = useState(50);
  const [signatureScale, setSignatureScale] = useState(1);
  const [signaturePlaced, setSignaturePlaced] = useState(false);
  const [isSelected, setIsSelected] = useState(false);

  const signatureWidthBase = 180;
  const signatureHeightBase = 64;
  const signatureWidthPx = Math.round(signatureWidthBase * signatureScale);
  const signatureHeightPx = Math.round(signatureHeightBase * signatureScale);

  // Signature Pad Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const previewStageRef = useRef<HTMLDivElement>(null);

  const [isEditMode, setIsEditMode] = useState(false);
  const [initialContent, setInitialContent] = useState<string>("");
  const highlightTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Rejection / Require Changes State
  const [rejectingItem, setRejectingItem] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [requireChangesItem, setRequireChangesItem] = useState(false);
  const [requireChangesMessage, setRequireChangesMessage] = useState("");
  const [showConfirmSubmit, setShowConfirmSubmit] = useState(false);

  // Derived State
  const isReviewMode = document?.category === "Reviewer" || document?.status === "reviewing";

  // Dragging Logic Refs
  const dragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startSigX: number;
    startSigY: number;
  } | null>(null);

  const sigResizeRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startScale: number;
  } | null>(null);

  // Load document once to check exists and get basic info
  useEffect(() => {
    if (!id) return;

    const loadDocumentInitial = async () => {
      try {
        const { data, error: fetchError } = await getGuestDocumentMetaData(id);

        if (fetchError) throw new Error(fetchError);
        if (!data) {
          setError("Document not found or access expired.");
          return;
        }

        setDocument(data);
        setInitialContent(data.content || "");

        // --- NEW: Platform Auth Check ---
        const { data: { user } } = await supabase.auth.getUser();
        if (user && user.email) {
          const userEmail = normalizeEmail(user.email);
          const recipients = data.recipients as Array<{ email: string }> || [];
          const isRecipient = recipients.some(r => normalizeEmail(r.email) === userEmail);
          
          if (isRecipient) {
            console.log("Logged-in platform user is a recipient, bypassing guest login.");
            setIsAuthenticated(true);
            setLoading(false);
            return;
          }
        }
        // ---------------------------------

        // Check if we have a valid session in localStorage
        const sessionKey = `sd_session_${id}`;
        const savedSession = localStorage.getItem(sessionKey);
        
        if (savedSession === "active") {
          setIsAuthenticated(true);
        }
      } catch (err: unknown) {
        console.error("Load error:", err);
        setError("Failed to connect to the secure document server.");
      } finally {
        setLoading(false);
      }
    };

    loadDocumentInitial();
  }, [id]);

  // Auto-enable edit mode for reviewers
  useEffect(() => {
    if (isAuthenticated && isReviewMode) {
      setIsEditMode(true);
    }
  }, [isAuthenticated, isReviewMode]);

  const handlePortalLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!document) return;
    
    setIsLoggingIn(true);
    setLoginError(null);

    // Validate credentials
    if (accessIdInput.trim() === document.access_id && accessPasswordInput.trim() === document.access_password) {
      try {
        let firstLoginTime = document.access_first_login;

        // If this is the very first login, update via server action
        if (!firstLoginTime) {
          const { data: now, error: updateError } = await markFirstLogin(id);
          if (updateError) throw new Error(updateError);
          firstLoginTime = now;
        }

        localStorage.setItem(`sd_session_${id}`, "active");
        setIsAuthenticated(true);
      } catch (err: unknown) {
        setLoginError("Failed to start session. Please try again.");
      }
    } else {
      setLoginError("Invalid Access ID or Password. Please check your email.");
    }
    setIsLoggingIn(false);
  };

  // Robust Global Pointer Listeners for Drag and Resize
  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      // Handle Dragging
      if (dragRef.current) {
        const drag = dragRef.current;
        const stage = previewStageRef.current;
        if (!stage) return;
        const rect = stage.getBoundingClientRect();
        const dx = e.clientX - drag.startClientX;
        const dy = e.clientY - drag.startClientY;

        const maxX = Math.max(0, Math.floor(rect.width - signatureWidthPx));
        const maxY = Math.max(0, Math.floor(rect.height - signatureHeightPx));

        setSignatureX(Math.min(Math.max(0, Math.round(drag.startSigX + dx)), maxX));
        setSignatureY(Math.min(Math.max(0, Math.round(drag.startSigY + dy)), maxY));
      }

      // Handle Resizing
      if (sigResizeRef.current) {
        const resize = sigResizeRef.current;
        const dx = e.clientX - resize.startClientX;
        const newScale = Math.min(2.5, Math.max(0.4, resize.startScale + dx / 180));
        setSignatureScale(newScale);
      }
    };

    const handlePointerUp = () => {
      dragRef.current = null;
      sigResizeRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [signatureWidthPx, signatureHeightPx]);

  const handleSignatureDragStart = (event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsSelected(true);
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startSigX: signatureX,
      startSigY: signatureY,
    };
  };

  const handleResizeStart = (event: React.PointerEvent) => {
    event.stopPropagation();
    event.preventDefault();
    sigResizeRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startScale: signatureScale,
    };
  };

  // Signature Pad Handlers
  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    isDrawing.current = true;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = ('touches' in e) ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = ('touches' in e) ? e.touches[0].clientY - rect.top : e.clientY - rect.top;
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = ('touches' in e) ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = ('touches' in e) ? e.touches[0].clientY - rect.top : e.clientY - rect.top;
    ctx.lineTo(x, y);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();
  };

  const endDrawing = () => { isDrawing.current = false; };
  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const saveToLocalSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const signatureDataUrl = canvas.toDataURL("image/png");
    setSavedSignature(signatureDataUrl);
    setShowSignModal(false);
    
    // Auto-place on document
    setSignaturePlaced(true);
    setSignatureX(50);
    setSignatureY(50);
  };

  const handleFinalSign = async () => {
    if (!isReviewMode && (!savedSignature || !signaturePlaced)) {
      alert("Please place your signature on the document first.");
      return;
    }

    setIsSubmitting(true);
    try {
      let finalContent = document?.content || "";
      
      if (isReviewMode && contentRef.current) {
        const editedHtml = contentRef.current.innerHTML;
        // Only apply diff highlighting if content changed and it's not already highlighted
        if (editedHtml !== initialContent) {
           finalContent = highlightHtmlEdits(initialContent, editedHtml);
        } else {
           finalContent = editedHtml;
        }
      }

      // Bake signature into HTML only if placed
      if (signaturePlaced && savedSignature) {
        const sigHtml = `<div style="position: absolute; left: ${signatureX}px; top: ${signatureY}px; width: ${signatureWidthPx}px; height: ${signatureHeightPx}px; z-index: 50; pointer-events: none;"><img src="${savedSignature}" alt="Signature" style="width: 100%; height: 100%; object-fit: contain;" /></div>`;
        finalContent += sigHtml;
      }

      const { success, error: subError } = await submitGuestSignature(id, savedSignature || "", signMessage, finalContent);
      
      if (!success) throw new Error(subError);
      
      setIsSigned(true);
    } catch (err: unknown) {
      alert("Failed to submit: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = async () => {
    setIsSubmitting(true);
    try {
      let finalContent = undefined;
      if (isReviewMode && contentRef.current) {
        const editedHtml = contentRef.current.innerHTML;
        finalContent = editedHtml !== initialContent ? highlightHtmlEdits(initialContent, editedHtml) : editedHtml;
      }
      const { success, error: subError } = await submitGuestSignature(id, "", rejectReason, finalContent, "rejected");
      if (!success) throw new Error(subError);
      setIsSigned(true);
    } catch (err: unknown) {
      alert("Failed to reject: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSubmitting(false);
      setRejectingItem(false);
    }
  };

  const handleRequireChanges = async () => {
    setIsSubmitting(true);
    try {
      let finalContent = undefined;
      if (isReviewMode && contentRef.current) {
        const editedHtml = contentRef.current.innerHTML;
        finalContent = editedHtml !== initialContent ? highlightHtmlEdits(initialContent, editedHtml) : editedHtml;
      }
      const { success, error: subError } = await submitGuestSignature(id, "", requireChangesMessage, finalContent, "changes_requested");
      if (!success) throw new Error(subError);
      setIsSigned(true);
    } catch (err: unknown) {
      alert("Failed to request changes: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSubmitting(false);
      setRequireChangesItem(false);
    }
  };

  const applyReviewHighlights = () => {
    if (!contentRef.current) return;

    const node = contentRef.current;
    
    // Save cursor position before update
    const savedSel = saveSelection(node);
    
    // Clean current HTML of existing highlight spans to avoid nesting
    const currentHtml = node.innerHTML;
    const cleanHtml = stripHighlights(currentHtml);
    
    // Generate new highlights
    const highlighted = highlightHtmlEdits(initialContent, cleanHtml);
    
    // Only update if visually different to avoid flicker
    if (highlighted !== currentHtml) {
      node.innerHTML = highlighted;
      restoreSelection(node, savedSel);
    }
    
    return highlighted;
  };

  const handleDocumentInput = () => {
    if (!isReviewMode) return;

    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
    }

    highlightTimeoutRef.current = setTimeout(() => {
      applyReviewHighlights();
    }, 500); // 500ms lively feedback
  };

  const handleToggleEdit = () => {
    const nextMode = !isEditMode;
    
    if (nextMode) {
      // Entering Edit Mode: Just switch
      setIsEditMode(true);
    } else {
      // Stopping Edit Mode: Force a sync to state so highlights persist on re-render
      if (contentRef.current) {
        const highlighted = applyReviewHighlights();
        setDocument(prev => prev ? { ...prev, content: highlighted } : null);
      }
      setIsEditMode(false);
    }
  };

  const handleResetChanges = () => {
    if (!window.confirm("Are you sure you want to reset all changes? This will restore the original document content.")) return;
    
    setDocument(prev => prev ? { ...prev, content: initialContent } : null);
    if (contentRef.current) {
      contentRef.current.innerHTML = initialContent;
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-violet-600" />
        <p className="mt-4 text-sm font-medium text-slate-500">Connecting to secure portal...</p>
      </div>
    );
  }

  // Success State
  if (isSigned) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 text-center">
        <div className="h-20 w-20 rounded-full bg-green-50 flex items-center justify-center mb-6">
          <CheckCircle2 className="h-10 w-10 text-green-600" />
        </div>
        <h2 className="text-3xl font-black text-slate-900 tracking-tight mb-2">
          {isReviewMode ? "Review Submitted!" : "Document Signed!"}
        </h2>
        <p className="text-slate-500 font-medium mb-12 max-w-sm">
          {isReviewMode 
            ? "Your approval has been recorded. The document owner will be notified."
            : "Everything looks great! You've successfully completed your part."}
        </p>
        <button 
          onClick={() => router.push('/')}
          className="mt-8 rounded-full bg-violet-600 px-8 py-3 text-sm font-bold text-white shadow-lg shadow-violet-200"
        >
          Return Home
        </button>
      </div>
    );
  }

  // Error State (Not Found)
  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 text-center">
        <div className="h-20 w-20 rounded-full bg-red-50 flex items-center justify-center mb-6">
          <AlertCircle className="h-10 w-10 text-red-500" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900">Document Unavailable</h1>
        <p className="mt-2 text-slate-500 max-w-sm">{error}</p>
        <button 
          onClick={() => router.push('/')}
          className="mt-8 rounded-full bg-violet-600 px-8 py-3 text-sm font-bold text-white shadow-lg shadow-violet-200"
        >
          Return to SMARTDOCS
        </button>
      </div>
    );
  }

  // Login Screen (Unauthenticated)
  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-600 text-2xl font-bold text-white shadow-xl shadow-violet-200 mb-4">S</div>
            <h1 className="text-2xl font-bold text-slate-900">Secure Document Portal</h1>
            <p className="text-slate-500 mt-2">Enter credentials from your invitation email</p>
          </div>

          <div className="bg-white rounded-[2.5rem] p-10 shadow-2xl shadow-violet-100 border border-white">
            <form onSubmit={handlePortalLogin} className="space-y-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">Access ID</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <input 
                    type="text" 
                    value={accessIdInput}
                    onChange={(e) => setAccessIdInput(e.target.value)}
                    placeholder="e.g. DOC-1234"
                    className="w-full pl-11 pr-4 py-4 rounded-2xl bg-slate-50 border-none outline-none focus:ring-2 focus:ring-violet-500 transition-all font-mono"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">Temporary Password</label>
                <div className="relative">
                  <ShieldCheck className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <input 
                    type="password"
                    value={accessPasswordInput}
                    onChange={(e) => setAccessPasswordInput(e.target.value)}
                    placeholder="Enter password"
                    className="w-full pl-11 pr-4 py-4 rounded-2xl bg-slate-50 border-none outline-none focus:ring-2 focus:ring-violet-500 transition-all font-mono"
                    required
                  />
                </div>
              </div>

              {loginError && (
                <div className="flex items-center gap-2 p-4 rounded-2xl bg-red-50 text-red-600 text-sm">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <p className="font-medium">{loginError}</p>
                </div>
              )}

              <button 
                type="submit"
                disabled={isLoggingIn}
                className="w-full py-4 rounded-2xl bg-violet-600 text-white font-bold shadow-lg shadow-violet-200 hover:bg-violet-700 active:scale-[0.98] transition-all disabled:opacity-50"
              >
                {isLoggingIn ? "Verifying..." : "Access Document"}
              </button>
            </form>
          </div>
          
          <p className="text-center text-xs text-slate-400 mt-8">
            This portal is secure and encrypted for document access.
          </p>
        </div>
      </div>
    );
  }

  // Document View (Authenticated)
  return (
    <div className="flex h-screen flex-col bg-slate-50 overflow-hidden">
      <header className="flex-shrink-0 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4 z-20">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600 text-sm font-bold text-white shadow-lg shadow-violet-100">
            S
          </div>
          <div>
            <p className="text-sm font-bold tracking-tight text-slate-900 uppercase">SMARTDOCS</p>
          </div>
        </div>
        
        {isAuthenticated && isReviewMode && (
          <div className="hidden md:flex items-center gap-3">
            <button
              onClick={() => { setRejectingItem(true); setRejectReason(""); }}
              disabled={isSubmitting}
              className="flex items-center gap-2 rounded-xl border border-red-100 bg-red-50/50 px-4 py-2 text-xs font-bold text-red-600 hover:bg-red-50 transition-all shadow-sm disabled:opacity-60"
            >
              <X className="h-3.5 w-3.5" /> Reject
            </button>

            <button
              onClick={() => { setRequireChangesItem(true); setRequireChangesMessage(""); }}
              disabled={isSubmitting}
              className="flex items-center gap-2 rounded-xl border border-amber-100 bg-amber-50/50 px-4 py-2 text-xs font-bold text-amber-600 hover:bg-amber-50 transition-all shadow-sm disabled:opacity-60"
            >
              <FileText className="h-3.5 w-3.5" /> Require Changes
            </button>

            <button
              onClick={handleResetChanges}
              disabled={isSubmitting}
              className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 transition-all shadow-sm disabled:opacity-60"
              title="Reset all changes"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </button>

            <button
              onClick={handleToggleEdit}
              disabled={isSubmitting}
              className={`flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-bold transition-all shadow-sm disabled:opacity-60 ${isEditMode ? 'border-violet-200 bg-violet-50 text-violet-700' : 'border-slate-100 bg-slate-50 text-slate-600 hover:bg-slate-100'}`}
            >
              {isEditMode ? (
                <><Save className="h-3.5 w-3.5" /> Stop Editing</>
              ) : (
                <><Edit3 className="h-3.5 w-3.5" /> Edit Document</>
              )}
            </button>

            <button
              onClick={() => setShowConfirmSubmit(true)}
              disabled={isSubmitting}
              className="flex items-center gap-2 rounded-xl bg-green-600 px-6 py-2 text-xs font-bold text-white shadow-lg shadow-green-200 hover:bg-green-700 transition-all disabled:opacity-60"
            >
              {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Approve
            </button>
            
            <button
              onClick={() => router.push('/')}
              className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-50 border border-slate-100 text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-all shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        <div className="text-right">
          <p className="text-xs font-bold text-slate-900">{document?.name}</p>
          <div className="flex items-center justify-end gap-2 text-[10px] text-green-600 font-bold uppercase">
            <ShieldCheck className="h-3 w-3" />
            Verified Access
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-hidden p-2 md:p-4 flex flex-col items-center">
        <div className="w-full max-w-[98vw] flex-1 flex flex-col rounded-3xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
          {/* Scrollable Document Area */}
          <div className="flex-1 overflow-y-auto bg-slate-100 p-4 md:p-8 min-h-0">
              <div 
                ref={previewStageRef}
                className="mx-auto max-w-[900px] bg-white shadow-sm p-8 md:p-16 min-h-full rounded-2xl border border-slate-100 relative"
              >

                
                {document?.content ? (
                  <div 
                    ref={contentRef}
                    contentEditable={isEditMode}
                    onInput={handleDocumentInput}
                    suppressContentEditableWarning
                    className={`prose prose-slate max-w-none outline-none transition-all duration-300 ${isEditMode ? 'p-6 rounded-2xl bg-amber-50/30 ring-2 ring-amber-200 shadow-inner min-h-[400px]' : ''}`} 
                    dangerouslySetInnerHTML={{ __html: document.content }} 
                  />
                ) : document?.file_url ? (
                  <div className="flex flex-col items-center justify-center py-40">
                    <FileText className="h-16 w-16 text-slate-200 mb-4" />
                    <p className="text-slate-500 font-medium text-center">This document is a PDF. Click buttons below to add your endorsement.</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-40">
                    <AlertCircle className="h-16 w-16 text-slate-200 mb-4" />
                    <p className="text-slate-500 font-medium">Document content unavailable.</p>
                  </div>
                )}

                {/* Placed Signature */}
                {!isReviewMode && signaturePlaced && savedSignature && (
                  <ResizableWrapper
                    x={signatureX}
                    y={signatureY}
                    width={signatureWidthPx}
                    height={signatureHeightPx}
                    isSelected={isSelected}
                    onSelect={() => setIsSelected(true)}
                    onDelete={() => setSignaturePlaced(false)}
                    onResizeStart={handleResizeStart}
                    onDragStart={handleSignatureDragStart}
                  >
                    <div className="w-full h-full flex items-center justify-center pointer-events-none">
                      <img src={savedSignature} alt="Signature" className="max-w-full max-h-full object-contain" />
                    </div>
                  </ResizableWrapper>
                )}
             </div>
          </div>
          
          {/* Fixed Footer */}
          <div className="flex-shrink-0 border-t border-slate-100 bg-white/95 backdrop-blur-md p-4 md:p-6">
            <div className="mx-auto max-w-5xl flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="text-center sm:text-left">
                <p className="text-base font-bold text-slate-900">{isReviewMode ? "" : "Ready to complete?"}</p>
                <p className="text-xs text-slate-500">
                  {isReviewMode 
                    ? ""
                    : savedSignature 
                      ? "Drag and resize your signature on the document above."
                      : "Create your signature first, then place it on the document."}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {isReviewMode ? (
                  null
                ) : (
                  <>
                    {!savedSignature ? (
                      <button 
                        onClick={() => setShowSignModal(true)}
                        className="flex items-center gap-3 rounded-2xl bg-violet-600 px-8 py-4 text-base font-bold text-white shadow-xl shadow-violet-200 transition-all hover:bg-violet-700 active:scale-95"
                      >
                        <Pen className="h-5 w-5" />
                        Create Signature
                      </button>
                    ) : (
                      <>
                        {!signaturePlaced && (
                          <button 
                            onClick={() => {
                              setSignaturePlaced(true);
                              setSignatureX(50);
                              setSignatureY(50);
                            }}
                            className="flex items-center gap-3 rounded-2xl bg-blue-600 px-8 py-4 text-base font-bold text-white shadow-xl shadow-blue-200 transition-all hover:bg-blue-700 active:scale-95"
                          >
                            <PenTool className="h-5 w-5" />
                            Place on Doc
                          </button>
                        )}
                        <button 
                          onClick={() => setShowSignModal(true)}
                          className="flex h-12 w-12 items-center justify-center rounded-2xl border-2 border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-all"
                          title="Change Signature"
                        >
                          <RotateCw className="h-5 w-5" />
                        </button>
                        <button 
                          onClick={() => setShowConfirmSubmit(true)}
                          disabled={isSubmitting || !signaturePlaced}
                          className="flex items-center gap-3 rounded-2xl bg-violet-600 px-10 py-4 text-base font-bold text-white shadow-xl shadow-violet-200 transition-all hover:bg-violet-700 active:scale-95 disabled:opacity-50"
                        >
                          {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <ShieldCheck className="h-5 w-5" />}
                          Submit Final
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Signature Modal */}
      {showSignModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl overflow-hidden">
             <div className="flex items-center justify-between p-8 border-b border-slate-100">
                <h3 className="text-xl font-bold text-slate-900 flex items-center gap-3">
                   <Pen className="h-5 w-5 text-violet-600" />
                   Create Your Signature
                </h3>
                <button onClick={() => setShowSignModal(false)} className="h-10 w-10 flex items-center justify-center rounded-full bg-slate-50 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-all">
                   <X className="h-5 w-5" />
                </button>
             </div>
             
             <div className="p-8 space-y-6">
                <div className="bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 relative">
                   <canvas 
                      ref={canvasRef}
                      width={440}
                      height={200}
                      onMouseDown={startDrawing}
                      onMouseMove={draw}
                      onMouseUp={endDrawing}
                      onMouseLeave={endDrawing}
                      onTouchStart={startDrawing}
                      onTouchMove={draw}
                      onTouchEnd={endDrawing}
                      className="w-full h-[200px] cursor-crosshair touch-none"
                   />
                   <button 
                      onClick={clearCanvas}
                      className="absolute bottom-4 right-4 flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-violet-600 transition-all"
                   >
                      <RotateCcw className="h-3 w-3" />
                      Clear
                   </button>
                </div>
                
                <div className="space-y-4">
                   <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block ml-1">Optional Message</label>
                   <textarea 
                     value={signMessage}
                     onChange={(e) => setSignMessage(e.target.value)}
                     className="w-full rounded-2xl bg-slate-50 border-none p-4 text-sm outline-none focus:ring-2 focus:ring-violet-500 transition-all resize-none"
                     placeholder="Any comments for the sender..."
                     rows={3}
                   />
                </div>
                
                <button 
                   onClick={saveToLocalSignature}
                   className="w-full py-4 rounded-2xl bg-violet-600 text-white font-bold shadow-lg shadow-violet-200 hover:bg-violet-700 active:scale-[0.98] transition-all"
                >
                   Save Signature
                </button>
             </div>
          </div>
        </div>
      )}

      {/* Rejection Reason Popup */}
      {rejectingItem && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md mx-4 bg-white rounded-[2rem] shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-8 pt-8 pb-4 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-900">Reject Document</h3>
              <p className="text-xs text-slate-500 mt-1">
                You are rejecting <span className="font-semibold text-slate-800">&ldquo;{document?.name}&rdquo;</span>.
              </p>
            </div>
            <div className="px-8 py-6 space-y-4">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block ml-1">
                Reason for rejection
              </label>
              <textarea
                className="w-full h-32 rounded-2xl bg-slate-50 border-none p-4 text-sm outline-none focus:ring-2 focus:ring-red-500 transition-all resize-none placeholder:text-slate-400"
                placeholder="e.g. Terms are incorrect, missing information..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                autoFocus
              />
            </div>
            <div className="px-8 pb-8 flex gap-3">
              <button
                onClick={() => { setRejectingItem(false); setRejectReason(""); }}
                className="flex-1 py-3.5 rounded-2xl text-slate-600 font-bold text-sm border border-slate-100 hover:bg-slate-50 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleReject}
                disabled={isSubmitting}
                className="flex-[2] py-3.5 rounded-2xl bg-red-600 text-white font-bold text-sm hover:bg-red-700 transition-all shadow-lg shadow-red-100 disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm Reject"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Require Changes Popup */}
      {requireChangesItem && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md mx-4 bg-white rounded-[2rem] shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-8 pt-8 pb-4 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-900">Require Changes</h3>
              <p className="text-xs text-slate-500 mt-1">
                Request modifications for <span className="font-semibold text-slate-800">&ldquo;{document?.name}&rdquo;</span>.
              </p>
            </div>
            <div className="px-8 py-6 space-y-4">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block ml-1">
                What needs to be changed?
              </label>
              <textarea
                className="w-full h-32 rounded-2xl bg-slate-50 border-none p-4 text-sm outline-none focus:ring-2 focus:ring-amber-500 transition-all resize-none placeholder:text-slate-400"
                placeholder="Describe the changes required..."
                value={requireChangesMessage}
                onChange={(e) => setRequireChangesMessage(e.target.value)}
                autoFocus
              />
            </div>
            <div className="px-8 pb-8 flex gap-3">
              <button
                onClick={() => { setRequireChangesItem(false); setRequireChangesMessage(""); }}
                className="flex-1 py-3.5 rounded-2xl text-slate-600 font-bold text-sm border border-slate-100 hover:bg-slate-50 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleRequireChanges}
                disabled={isSubmitting}
                className="flex-[2] py-3.5 rounded-2xl bg-amber-500 text-white font-bold text-sm hover:bg-amber-600 transition-all shadow-lg shadow-amber-100 disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send Request"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Popup */}
      {showConfirmSubmit && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-sm mx-4 bg-white rounded-[2rem] shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-8 pt-8 pb-4 border-b border-slate-100 text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-violet-100 flex items-center justify-center text-violet-600 mb-4">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">
                {isReviewMode ? "Confirm Approval" : "Confirm Signature"}
              </h3>
              <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                {isReviewMode 
                  ? "Are you sure you want to approve this document? This will finalize your review and notify the sender."
                  : "Are you sure you want to submit your signature? This will finalize the document."}
              </p>
            </div>
            <div className="px-8 py-6 flex gap-3">
              <button
                onClick={() => setShowConfirmSubmit(false)}
                className="flex-1 py-3.5 rounded-2xl text-slate-600 font-bold text-sm border border-slate-100 hover:bg-slate-50 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowConfirmSubmit(false);
                  handleFinalSign();
                }}
                disabled={isSubmitting}
                className="flex-[2] py-3.5 rounded-2xl bg-violet-600 text-white font-bold text-sm hover:bg-violet-700 transition-all shadow-lg shadow-violet-100 disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm & Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
