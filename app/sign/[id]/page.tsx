"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { CheckCircle2, Loader2, FileText, PenLine as Pen, Lock, ShieldCheck, AlertCircle, Clock, X, RotateCcw, Edit3, Save, Eye as EyeIcon, RotateCw, PenTool, ChevronLeft, MessageSquare } from "lucide-react";
import { getGuestDocumentMetaData, markFirstLogin, submitGuestSignature } from "../../actions/document-guest";
import {
  buildPositionedDocumentHtml,
  DOCUMENT_STAGE_FONT_FAMILY,
  DOCUMENT_STAGE_MIN_HEIGHT,
  DOCUMENT_STAGE_PADDING,
  renderDocumentStageBodyHtml,
} from "../../lib/document-stage";
import { highlightHtmlEdits, saveSelection, restoreSelection, stripHighlights } from "../../lib/diff";
import { supabase } from "../../lib/supabase/browser";
import { normalizeEmail } from "../../lib/documents";

interface PlacedField {
  id: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  scale?: number;
  value?: string;
}

const DEFAULT_FIELD_SIZE: Record<string, { width: number; height: number }> = {
  stamp: { width: 180, height: 64 },
  initial: { width: 100, height: 36 },
  date: { width: 140, height: 36 },
  name: { width: 180, height: 40 },
  first_name: { width: 160, height: 40 },
  last_name: { width: 160, height: 40 },
  email: { width: 220, height: 40 },
  company: { width: 180, height: 40 },
  title: { width: 160, height: 40 },
  text: { width: 180, height: 44 },
  checkbox: { width: 24, height: 24 },
};

const MIN_FIELD_SIZE: Record<string, { width: number; height: number }> = {
  stamp: { width: 110, height: 40 },
  initial: { width: 72, height: 28 },
  date: { width: 100, height: 28 },
  name: { width: 110, height: 32 },
  first_name: { width: 110, height: 32 },
  last_name: { width: 110, height: 32 },
  email: { width: 150, height: 32 },
  company: { width: 110, height: 32 },
  title: { width: 100, height: 32 },
  text: { width: 110, height: 36 },
  checkbox: { width: 20, height: 20 },
};

const DRAGGABLE_FIELDS = [
  // Group 1
  { type: "initial", label: "Initial", icon: <PenTool className="h-4 w-4 text-slate-700" />, group: 1 },
  { type: "date", label: "Date Signed", icon: <Clock className="h-4 w-4 text-slate-700" />, group: 1 },
  // Group 2
  { type: "name", label: "Name", icon: <Edit3 className="h-4 w-4 text-slate-700" />, group: 2 },
  { type: "first_name", label: "First Name", icon: <Edit3 className="h-4 w-4 text-slate-700" />, group: 2 },
  { type: "last_name", label: "Last Name", icon: <Edit3 className="h-4 w-4 text-slate-700" />, group: 2 },
  { type: "email", label: "Email Address", icon: <Edit3 className="h-4 w-4 text-slate-700" />, group: 2 },
  { type: "company", label: "Company", icon: <Edit3 className="h-4 w-4 text-slate-700" />, group: 2 },
  { type: "title", label: "Title", icon: <Edit3 className="h-4 w-4 text-slate-700" />, group: 2 },
] as const;

const getFieldSize = (field: Pick<PlacedField, "type" | "width" | "height">) => {
  const fallback = DEFAULT_FIELD_SIZE[field.type] || { width: 180, height: 40 };
  return {
    width: field.width ?? fallback.width,
    height: field.height ?? fallback.height,
  };
};

const clampFieldPosition = (field: PlacedField, x: number, y: number, stage: HTMLDivElement | null) => {
  if (!stage) {
    return {
      x: Math.max(0, Math.round(x)),
      y: Math.max(0, Math.round(y)),
    };
  }

  const rect = stage.getBoundingClientRect();
  const { width, height } = getFieldSize(field);

  return {
    x: Math.min(Math.max(0, Math.round(x)), Math.max(0, Math.floor(rect.width - width))),
    y: Math.min(Math.max(0, Math.round(y)), Math.max(0, Math.floor(rect.height - height))),
  };
};

interface ResizableWrapperProps {
  field: PlacedField;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onResizeStart: (e: React.PointerEvent) => void;
  onDragStart: (e: React.PointerEvent) => void;
  onEdit: () => void;
  children: React.ReactNode;
}

const ResizableWrapper = ({
  field,
  isSelected,
  onSelect,
  onDelete,
  onResizeStart,
  onDragStart,
  onEdit,
  children,
}: ResizableWrapperProps) => {
  const { width, height } = getFieldSize(field);
  return (
    <div
      className={`absolute rounded-md border-2 border-dashed group flex items-center justify-center cursor-grab active:cursor-grabbing select-none transition-all ${
        isSelected ? "border-violet-500 bg-violet-50/50" : "border-slate-400 hover:border-violet-400"
      }`}
      style={{
        left: `${field.x}px`,
        top: `${field.y}px`,
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
      <div 
        className="w-full h-full flex items-center justify-center pointer-events-auto"
        onClick={(e) => { e.stopPropagation(); onEdit(); }}
      >
        {children}
      </div>
      {/* Delete button (Top-right) */}
      <button
        type="button"
        className={`absolute -right-2 -top-2 h-5 w-5 rounded-full bg-red-500 border border-white text-white shadow flex items-center justify-center hover:bg-red-600 transition-all active:scale-90 z-[110] ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <X className="h-2.5 w-2.5" />
      </button>

      {/* Resize handle (Bottom-right) */}
      <div
        className={`absolute -right-2 -bottom-2 w-5 h-5 cursor-nwse-resize bg-violet-600 rounded-full shadow-md hover:bg-violet-500 transition-all border-2 border-white flex items-center justify-center z-[110] ${isSelected ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
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
  
  // Multi-Mode Signature State
  const [signatureMode, setSignatureMode] = useState<'draw' | 'type' | 'upload'>('upload');
  const [typedSignature, setTypedSignature] = useState("");
  const [uploadedSignature, setUploadedSignature] = useState<string | null>(null);
  
  // Drag and Drop Field State
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const [placedFields, setPlacedFields] = useState<PlacedField[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [editingFieldData, setEditingFieldData] = useState<{ id: string; label: string; value: string } | null>(null);

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
  const dragRef = useRef<{ id: string; startClientX: number; startClientY: number; startX: number; startY: number } | null>(null);
  const resizeRef = useRef<{ id: string; startClientX: number; startClientY: number; startWidth: number; startHeight: number } | null>(null);
  const movedFieldRef = useRef<string | null>(null);
  const skipFieldClickRef = useRef<string | null>(null);

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
    const onMove = (e: PointerEvent) => {
      if (dragRef.current) {
        const { id, startClientX, startClientY, startX, startY } = dragRef.current;
        const dx = e.clientX - startClientX;
        const dy = e.clientY - startClientY;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
          movedFieldRef.current = id;
        }
        
        setPlacedFields(prev => {
          const field = prev.find(f => f.id === id);
          if (!field) return prev;
          const nextPos = clampFieldPosition(field, startX + dx, startY + dy, previewStageRef.current);
          return prev.map(f => {
            if (f.id === id) {
              return {
                ...f,
                x: nextPos.x,
                y: nextPos.y
              };
            }
            return f;
          });
        });
      }
      if (resizeRef.current) {
        const { id, startClientX, startClientY, startHeight, startWidth } = resizeRef.current;
        const dx = e.clientX - startClientX;
        const dy = e.clientY - startClientY;
        movedFieldRef.current = id;
        
        setPlacedFields(prev => prev.map(f => {
          if (f.id !== id) return f;

          const minSize = MIN_FIELD_SIZE[f.type] || { width: 80, height: 28 };
          const width = Math.max(minSize.width, Math.round(startWidth + dx));
          const height = Math.max(
            minSize.height,
            Math.round(
              f.type === "checkbox"
                ? startHeight + Math.max(dx, dy)
                : startHeight + dy
            )
          );
          const resizedField = {
            ...f,
            width,
            height,
          };
          const nextPos = clampFieldPosition(resizedField, resizedField.x, resizedField.y, previewStageRef.current);

          return {
            ...resizedField,
            x: nextPos.x,
            y: nextPos.y,
          };
        }));
      }
    };
    const onUp = () => {
      if (movedFieldRef.current) {
        skipFieldClickRef.current = movedFieldRef.current;
      }
      dragRef.current = null;
      resizeRef.current = null;
      movedFieldRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  const addPlacedField = (type: string, value?: string, position?: { x: number; y: number }) => {
    const defaultSize = DEFAULT_FIELD_SIZE[type] || { width: 180, height: 40 };
    const fieldId = crypto.randomUUID();
    const baseField: PlacedField = {
      id: fieldId,
      type,
      x: position?.x ?? 50,
      y: position?.y ?? 50,
      width: defaultSize.width,
      height: defaultSize.height,
      scale: 1,
      value,
    };
    const nextPos = clampFieldPosition(baseField, baseField.x, baseField.y, previewStageRef.current);

    setPlacedFields(prev => [...prev, { ...baseField, x: nextPos.x, y: nextPos.y }]);
    setSelectedFieldId(fieldId);
  };

  const handleFieldDragStart = (id: string, event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedFieldId(id);
    const field = placedFields.find(f => f.id === id);
    if (!field) return;

    dragRef.current = {
      id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: field.x,
      startY: field.y,
    };
  };

  const handleResizeStart = (id: string, event: React.PointerEvent) => {
    event.stopPropagation();
    event.preventDefault();
    const field = placedFields.find(f => f.id === id);
    if (!field) return;
    const { width, height } = getFieldSize(field);

    resizeRef.current = {
      id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWidth: width,
      startHeight: height,
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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setUploadedSignature(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const saveToLocalSignature = async () => {
    let finalSignatureUrl = "";

    if (signatureMode === 'draw') {
      const canvas = canvasRef.current;
      if (!canvas) return;
      finalSignatureUrl = canvas.toDataURL("image/png");
    } else if (signatureMode === 'upload') {
      if (!uploadedSignature) return;
      
      // Process uploaded image to remove white background
      try {
        const img = new Image();
        img.src = uploadedSignature;
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
        });

        const tempCanvas = window.document.createElement('canvas');
        tempCanvas.width = img.width;
        tempCanvas.height = img.height;
        const ctx = tempCanvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
          const data = imageData.data;
          
          for (let i = 0; i < data.length; i += 4) {
            // Remove white/near-white pixels
            if (data[i] > 230 && data[i+1] > 230 && data[i+2] > 230) {
              data[i+3] = 0;
            }
          }
          
          ctx.putImageData(imageData, 0, 0);
          finalSignatureUrl = tempCanvas.toDataURL("image/png");
        }
      } catch (err) {
        console.error("Failed to process signature transparency:", err);
        finalSignatureUrl = uploadedSignature; // Fallback
      }
    } else if (signatureMode === 'type') {
      if (!typedSignature) return;
      // Render typed text to temporary canvas (transparent background)
      const tempCanvas = window.document.createElement('canvas');
      tempCanvas.width = 440;
      tempCanvas.height = 200;
      const ctx = tempCanvas.getContext('2d');
      if (ctx) {
        ctx.font = 'italic 48px "Dancing Script", cursive';
        ctx.fillStyle = '#1e293b';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(typedSignature, 220, 100);
        finalSignatureUrl = tempCanvas.toDataURL("image/png");
      }
    }

    if (!finalSignatureUrl) return;
    
    setSavedSignature(finalSignatureUrl);
    setShowSignModal(false);
    addPlacedField("stamp", finalSignatureUrl);
  };

  const handleFinalSign = async () => {
    if (!isReviewMode && placedFields.length === 0) {
      alert("Please place at least one field on the document first.");
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

      // Bake all placed fields into HTML
      if (!isReviewMode && placedFields.length > 0) {
        let fieldsHtml = "";
        placedFields.forEach(field => {
          const { width, height } = getFieldSize(field);
          const alignmentStyle = field.type === "stamp" ? "justify-content: center;" : "justify-content: flex-start; padding-left: 8px;";
          const style = `position: absolute; left: ${field.x}px; top: ${field.y}px; width: ${width}px; height: ${height}px; z-index: 50; pointer-events: none; display: flex; align-items: center; ${alignmentStyle} box-sizing: border-box;`;
          
          if (field.type === "stamp" && field.value) {
            fieldsHtml += `<div style="${style}"><img src="${field.value}" alt="Signature" style="width: 100%; height: 100%; object-fit: contain;" /></div>`;
          } else if (field.value) {
            const fontSize = Math.max(12, Math.min(24, Math.round(height * 0.4)));
            fieldsHtml += `<div style="${style} font-family: sans-serif; font-size: ${fontSize}px; font-weight: 600; color: #1e293b; white-space: nowrap; overflow: hidden;">${field.value}</div>`;
          }
        });

        // Wrap in a self-contained relative container (800px, no padding) so that
        // the absolute-positioned fields perfectly match the internal sender views.
        finalContent = buildPositionedDocumentHtml(stripHighlights(document?.content || ""), fieldsHtml);
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

  const promptFieldValue = (id: string, label: string) => {
    const field = placedFields.find(f => f.id === id);
    if (!field) return;
    
    // Instead of window.prompt, we set state to open our custom modal
    setEditingFieldData({
      id: id,
      label: label,
      value: field.value || ""
    });
  };

  const handleSaveField = () => {
    if (!editingFieldData) return;
    const { id, value } = editingFieldData;
    
    setPlacedFields(prev => prev.map(f => f.id === id ? { ...f, value: value } : f));
    setEditingFieldData(null);
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

  const handleReject = async () => {
    setIsSubmitting(true);
    try {
      // Rejections don't need content updates, just the status and reason
      const { success, error: subError } = await submitGuestSignature(id, "", rejectReason, undefined, "rejected");
      if (!success) throw new Error(subError);
      setIsSigned(true);
    } catch (err: unknown) {
      alert("Failed to reject: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSubmitting(false);
      setRejectingItem(false);
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
      // Entering Edit Mode: Strip existing highlights so user edits clean text
      if (contentRef.current) {
        const clean = stripHighlights(contentRef.current.innerHTML);
        contentRef.current.innerHTML = clean;
        setDocument(prev => prev ? { ...prev, content: clean } : null);
      }
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
        <div className="flex items-center gap-6">
          <div 
            onClick={() => router.push('/')}
            className="flex items-center gap-1.5 text-slate-500 hover:text-slate-900 font-medium text-sm border-r border-slate-200 pr-4 mr-1 transition-colors cursor-pointer"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </div>
          <div className="flex items-center gap-3">
             <div className="h-9 w-9 flex items-center justify-center rounded-xl bg-[#f0ecfe] text-[15px] font-bold text-[#5b2df6]">
               {document?.name?.[0]?.toUpperCase() || 'D'}
             </div>
             <div>
               <h3 className="text-sm font-bold text-slate-900 leading-tight">{document?.name}</h3>
               <p className="text-[11px] text-slate-500 font-medium">Please {isReviewMode ? 'review' : 'sign'}: {document?.name}</p>
             </div>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
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
              <MessageSquare className="h-3.5 w-3.5" /> Require Changes
            </button>

            {!isReviewMode && (
              <button
                onClick={() => {
                  const hasStamp = placedFields.some(f => f.type === 'stamp');
                  if (!hasStamp && placedFields.length === 0) {
                    alert("Please place your signature/sign on the document first.");
                    return;
                  }
                  setShowConfirmSubmit(true);
                }}
                disabled={isSubmitting}
                className="flex items-center gap-2 rounded-xl bg-green-600 px-6 py-2.5 text-xs font-bold text-white shadow-lg shadow-green-200 hover:bg-green-700 transition-all disabled:opacity-60"
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Send
              </button>
            )}

            {isReviewMode ? (
              <>
                <button
                  onClick={handleResetChanges}
                  disabled={isSubmitting}
                  className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-50 transition-all shadow-sm disabled:opacity-60"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Reset
                </button>
                {isEditMode ? (
                  <button
                    onClick={handleToggleEdit}
                    className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all shadow-sm"
                  >
                    <Save className="h-3.5 w-3.5" /> Stop editing
                  </button>
                ) : (
                  <button
                    onClick={handleToggleEdit}
                    className="flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2 text-xs font-bold text-violet-700 hover:bg-violet-100 transition-all shadow-sm"
                  >
                    <Edit3 className="h-3.5 w-3.5" /> Edit Document
                  </button>
                )}
                <button
                  onClick={() => setShowConfirmSubmit(true)}
                  disabled={isSubmitting}
                  className="flex items-center gap-2 rounded-xl bg-violet-600 px-6 py-2 text-xs font-bold text-white shadow-lg shadow-violet-200 hover:bg-violet-700 transition-all disabled:opacity-60"
                >
                  {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />} Approve
                </button>
              </>
            ) : (
              <button
                onClick={() => {
                  const hasStamp = placedFields.some(f => f.type === 'stamp');
                  if (!hasStamp) {
                    setSignatureMode("draw");
                    setShowSignModal(true);
                  } else {
                    setShowConfirmSubmit(true);
                  }
                }}
                disabled={isSubmitting}
                className="flex items-center gap-2 rounded-xl bg-[#5b2df6] px-6 py-2.5 text-xs font-bold text-white shadow-lg shadow-violet-200 hover:bg-violet-700 transition-all disabled:opacity-60"
              >
                {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PenTool className="h-3.5 w-3.5" />} Sign on Document
              </button>
            )}
            
            <button
               onClick={() => router.push('/')}
               className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-50 border border-slate-100 text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-all shrink-0"
            >
               <X className="w-5 h-5" />
            </button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden flex bg-slate-50 relative">
        {/* ADD FIELDS Sidebar (only for Signers) */}
        {!isReviewMode && (
          <aside className="w-64 border-r border-slate-200 bg-white flex flex-col p-6 overflow-y-auto">
             <h2 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-6">ADD FIELDS</h2>
             <p className="text-xs text-slate-500 mb-8 font-medium leading-relaxed">Click or drag fields to place them on the document.</p>
             
             <div className="space-y-3">
                {/* Group 1: Signatures/Dates */}
                <div className="space-y-3">
                   {DRAGGABLE_FIELDS.filter(f => f.group === 1).map(field => (
                     <div 
                        key={field.type}
                        onClick={() => {
                          if (field.type === "stamp") {
                            setSignatureMode("upload");
                            setShowSignModal(true);
                          }
                          else if (field.type === "date") addPlacedField(field.type, new Date().toLocaleDateString());
                          else addPlacedField(field.type);
                        }}
                        className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 bg-slate-50/50 cursor-pointer hover:bg-white hover:border-violet-200 hover:shadow-sm hover:translate-x-1 transition-all group"
                     >
                        <div className="h-8 w-8 flex items-center justify-center rounded-lg bg-white border border-slate-100 group-hover:border-violet-100 transition-colors">
                           {field.icon}
                        </div>
                        <span className="text-sm font-semibold text-slate-700">{field.label}</span>
                     </div>
                   ))}
                </div>

                {/* Group 2: Personal Fields */}
                <div className="space-y-3">
                   {DRAGGABLE_FIELDS.filter(f => f.group === 2).map(field => (
                     <div 
                        key={field.type}
                        onClick={() => addPlacedField(field.type)}
                        className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 bg-slate-50/50 cursor-pointer hover:bg-white hover:border-violet-200 hover:shadow-sm hover:translate-x-1 transition-all group"
                     >
                        <div className="h-8 w-8 flex items-center justify-center rounded-lg bg-white border border-slate-100 group-hover:border-violet-100 transition-colors">
                           {field.icon}
                        </div>
                        <span className="text-sm font-semibold text-slate-700">{field.label}</span>
                     </div>
                   ))}
                </div>
             </div>
          </aside>
        )}

        {/* Scrollable Document Area */}
        <div 
           className="flex-1 overflow-y-auto bg-slate-100 p-8 flex flex-col items-center"
           onClick={() => setSelectedFieldId(null)}
        >
            <div className="max-w-4xl mx-auto flex justify-center">
              <div 
                ref={previewStageRef}
                className="relative w-[800px]"
              >
              {document?.content ? (
                <div 
                  ref={contentRef}
                  contentEditable={isEditMode}
                  onInput={handleDocumentInput}
                  suppressContentEditableWarning
                  className={`relative editable-content document-content w-full bg-white rounded-2xl shadow-xl border border-slate-200 text-[15px] text-slate-800 leading-[1.9] outline-none transition-all duration-300 ${isEditMode ? 'ring-4 ring-amber-100 bg-amber-50/10' : ''}`}
                  style={{
                    minHeight: `${DOCUMENT_STAGE_MIN_HEIGHT}px`,
                    padding: `${DOCUMENT_STAGE_PADDING}px`,
                    fontFamily: DOCUMENT_STAGE_FONT_FAMILY,
                  }}
                  dangerouslySetInnerHTML={{ __html: renderDocumentStageBodyHtml(document.content || "") }}
                />
              ) : document?.file_url ? (
                <div className="flex flex-col items-center justify-center py-40">
                  <FileText className="h-16 w-16 text-slate-200 mb-4" />
                  <p className="text-slate-500 font-medium text-center">This document is a PDF. Click fields on the left to add your endorsement.</p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-40">
                  <AlertCircle className="h-16 w-16 text-slate-200 mb-4" />
                  <p className="text-slate-500 font-medium">Document content unavailable.</p>
                </div>
              )}

              {/* Render Placed Fields */}
              {!isReviewMode && placedFields.map(field => {
                const def = DRAGGABLE_FIELDS.find(f => f.type === field.type);
                const { height } = getFieldSize(field);
                
                return (
                  <ResizableWrapper
                    key={field.id}
                    field={field}
                    isSelected={selectedFieldId === field.id}
                    onSelect={() => setSelectedFieldId(field.id)}
                    onDelete={() => setPlacedFields(prev => prev.filter(f => f.id !== field.id))}
                    onResizeStart={(e) => handleResizeStart(field.id, e)}
                    onDragStart={(e) => handleFieldDragStart(field.id, e)}
                    onEdit={() => {
                      if (field.type !== "stamp") {
                        promptFieldValue(field.id, def?.label || "Value");
                      }
                    }}
                  >
                    {field.type === "stamp" ? (
                      <img src={field.value} alt="Stamp" className="max-w-full max-h-full object-contain p-1" />
                    ) : (
                      <div 
                        className="flex h-full w-full items-center text-slate-800 font-bold px-2 whitespace-nowrap overflow-hidden"
                        style={{ fontSize: `${Math.max(12, Math.min(22, Math.round(height * 0.4)))}px` }}
                      >
                         {field.value || <span className="text-slate-300 font-normal italic">[{def?.label || 'Empty'}]</span>}
                      </div>
                    )}
                  </ResizableWrapper>
                )
              })}
            </div>
            </div>
        </div>
      </main>

      {/* Signature Modal */}
      {showSignModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <link href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@400;700&display=swap" rel="stylesheet" />
          <div className="w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl overflow-hidden">
             <div className="flex items-center justify-between p-8 border-b border-slate-100">
                <h3 className="text-xl font-bold text-slate-900 flex items-center gap-3">
                   <Pen className="h-5 w-5 text-violet-600" />
                   Add Your Sign
                </h3>
                <button onClick={() => setShowSignModal(false)} className="h-10 w-10 flex items-center justify-center rounded-full bg-slate-50 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-all">
                   <X className="h-5 w-5" />
                </button>
             </div>
             
             <div className="p-8 space-y-6">
                {/* Tab Switcher */}
                <div className="flex p-1 bg-slate-50 rounded-2xl border border-slate-100">
                   {(['draw', 'type', 'upload'] as const).map((mode) => (
                     <button
                        key={mode}
                        onClick={() => setSignatureMode(mode)}
                        className={`flex-1 py-3 text-xs font-bold rounded-xl transition-all ${
                          signatureMode === mode 
                          ? 'bg-white text-violet-600 shadow-sm' 
                          : 'text-slate-500 hover:text-slate-700'
                        }`}
                     >
                        {mode === 'draw' ? 'Manual' : mode === 'type' ? 'Type' : 'Upload'}
                     </button>
                   ))}
                </div>

                <div className="min-h-[220px]">
                   {signatureMode === 'draw' && (
                      <div className="bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 relative animate-in fade-in zoom-in-95 duration-200">
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
                   )}

                   {signatureMode === 'type' && (
                      <div className="space-y-6 animate-in fade-in zoom-in-95 duration-200">
                         <div className="relative">
                            <input 
                               type="text"
                               placeholder="Type your name here..."
                               value={typedSignature}
                               onChange={(e) => setTypedSignature(e.target.value)}
                               className="w-full px-6 py-5 rounded-2xl bg-slate-50 border-2 border-slate-100 text-slate-700 font-semibold focus:border-violet-300 focus:bg-white focus:outline-none transition-all"
                            />
                         </div>
                         <div className="h-[120px] flex items-center justify-center rounded-2xl bg-[#fafafa] border border-slate-100 overflow-hidden">
                            {typedSignature ? (
                               <p className="text-4xl text-slate-800 font-bold" style={{ fontFamily: '"Dancing Script", cursive' }}>
                                 {typedSignature}
                               </p>
                            ) : (
                               <p className="text-sm text-slate-300 italic">Signature preview will appear here</p>
                            )}
                         </div>
                      </div>
                   )}

                   {signatureMode === 'upload' && (
                      <div className="animate-in fade-in zoom-in-95 duration-200">
                         <label className="flex flex-col items-center justify-center w-full h-[200px] bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 cursor-pointer hover:bg-slate-100 hover:border-violet-300 transition-all group overflow-hidden">
                            {uploadedSignature ? (
                               <img src={uploadedSignature} alt="Uploaded signature" className="max-w-full max-h-full object-contain p-4" />
                            ) : (
                               <div className="text-center p-6">
                                  <div className="h-12 w-12 bg-white rounded-xl shadow-sm border border-slate-100 flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform">
                                     <Save className="h-6 w-6 text-slate-400" />
                                  </div>
                                  <p className="text-sm font-bold text-slate-600">Click to upload image</p>
                                  <p className="text-[10px] text-slate-400 mt-1">PNG, JPG recommended</p>
                               </div>
                            )}
                            <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                         </label>
                      </div>
                   )}
                </div>
                
                <button 
                   onClick={saveToLocalSignature}
                   className="w-full py-4 rounded-2xl bg-violet-600 text-white font-bold shadow-lg shadow-violet-200 hover:bg-violet-700 active:scale-[0.98] transition-all"
                >
                   Save Sign
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

      {/* Field Edit Modal */}
      {editingFieldData && (
        <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-sm mx-4 bg-white rounded-[2rem] shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-8 pt-8 pb-4 border-b border-slate-100 text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 mb-4">
                <Edit3 className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Enter {editingFieldData.label}</h3>
              <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                Please provide the value for this field.
              </p>
            </div>
            <div className="px-8 py-6">
              <input
                type="text"
                className="w-full py-3.5 px-4 rounded-2xl bg-slate-50 border-none outline-none focus:ring-2 focus:ring-blue-500 transition-all text-sm text-slate-800 placeholder:text-slate-400 font-medium"
                placeholder={`Type ${editingFieldData.label.toLowerCase()}...`}
                value={editingFieldData.value}
                onChange={(e) => setEditingFieldData({ ...editingFieldData, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveField();
                  if (e.key === "Escape") setEditingFieldData(null);
                }}
                autoFocus
              />
            </div>
            <div className="px-8 pb-8 flex gap-3">
              <button
                onClick={() => setEditingFieldData(null)}
                className="flex-1 py-3.5 rounded-2xl text-slate-600 font-bold text-sm border border-slate-100 hover:bg-slate-50 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveField}
                className="flex-[2] py-3.5 rounded-2xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 transition-all shadow-lg shadow-blue-100"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
