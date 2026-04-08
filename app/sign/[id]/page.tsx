/* eslint-disable @next/next/no-img-element */
"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { CheckCircle2, Loader2, FileText, PenLine as Pen, Lock, ShieldCheck, AlertCircle, Clock, X, RotateCcw } from "lucide-react";
import { getGuestDocumentMetaData, markFirstLogin, submitGuestSignature } from "../../actions/document-guest";

export default function PublicSignPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [document, setDocument] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Login State
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [accessIdInput, setAccessIdInput] = useState("");
  const [accessPasswordInput, setAccessPasswordInput] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<string | null>(null);

  // Signing State
  const [showSignModal, setShowSignModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSigned, setIsSigned] = useState(false);
  const [signMessage, setSignMessage] = useState("");
  
  // Signature Pad Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);

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

        // Check if we have a valid session in localStorage
        const sessionKey = `sd_session_${id}`;
        const savedSession = localStorage.getItem(sessionKey);
        
        if (savedSession === "active") {
          // If we have a first login time, verify the 10-min rule
          if (data.access_first_login) {
            const firstLogin = new Date(data.access_first_login);
            const now = new Date();
            const diffMs = now.getTime() - firstLogin.getTime();
            const diffMins = diffMs / 1000 / 60;

            if (diffMins < 10) {
              setIsAuthenticated(true);
              startTimer(firstLogin);
            } else {
              setError("Your session has expired (10-minute limit reached).");
              localStorage.removeItem(sessionKey);
            }
          } else {
             // If active session but no first login timestamp in DB somehow, 
             // but we'll assume it's okay and treat as authenticated
             setIsAuthenticated(true);
          }
        }
      } catch (err: any) {
        console.error("Load error:", err);
        setError("Failed to connect to the secure document server.");
      } finally {
        setLoading(false);
      }
    };

    loadDocumentInitial();
  }, [id]);

  const startTimer = (startTime: Date) => {
    const update = () => {
       const now = new Date();
       const diffMs = now.getTime() - startTime.getTime();
       const remainingMs = (10 * 60 * 1000) - diffMs;
       
       if (remainingMs <= 0) {
         setIsAuthenticated(false);
         setError("Your session has expired.");
         setTimeRemaining(null);
         return false;
       } else {
         const mins = Math.floor(remainingMs / 1000 / 60);
         const secs = Math.floor((remainingMs / 1000) % 60);
         setTimeRemaining(`${mins}:${secs.toString().padStart(2, '0')}`);
         return true;
       }
    };

    update();
    const interval = setInterval(() => {
       if (!update()) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  };

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
        } else {
          // Check if existing first login is older than 10 mins
          const firstLogin = new Date(firstLoginTime);
          const now = new Date();
          const diffMs = now.getTime() - firstLogin.getTime();
          if (diffMs > 10 * 60 * 1000) {
            setLoginError("This session has already expired.");
            setIsLoggingIn(false);
            return;
          }
        }

        localStorage.setItem(`sd_session_${id}`, "active");
        setIsAuthenticated(true);
        startTimer(new Date(firstLoginTime));
      } catch (err) {
        setLoginError("Failed to start session. Please try again.");
      }
    } else {
      setLoginError("Invalid Access ID or Password. Please check your email.");
    }
    setIsLoggingIn(false);
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
    e.preventDefault();
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
    ctx.stroke();
    e.preventDefault();
  };

  const endDrawing = () => {
    isDrawing.current = false;
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const handleFinalSign = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    setIsSubmitting(true);
    try {
      const signatureDataUrl = canvas.toDataURL("image/png");
      const { success, error: subError } = await submitGuestSignature(id, signatureDataUrl, signMessage);
      
      if (!success) throw new Error(subError);
      
      setIsSigned(true);
      setShowSignModal(false);
    } catch (err: any) {
      alert("Failed to submit signature: " + err.message);
    } finally {
      setIsSubmitting(false);
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
          <CheckCircle2 className="h-10 w-10 text-green-500" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900">Successfully Signed!</h1>
        <p className="mt-2 text-slate-500 max-w-sm">Thank you for your digital signature. The document owner has been notified.</p>
        <button 
          onClick={() => router.push('/')}
          className="mt-8 rounded-full bg-violet-600 px-8 py-3 text-sm font-bold text-white shadow-lg shadow-violet-200"
        >
          Return Home
        </button>
      </div>
    );
  }

  // Error State (Expired or Not Found)
  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 text-center">
        <div className="h-20 w-20 rounded-full bg-red-50 flex items-center justify-center mb-6">
          <Clock className="h-10 w-10 text-red-500" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900">Access Expired</h1>
        <p className="mt-2 text-slate-500 max-w-sm">{error}</p>
        <p className="mt-4 text-sm text-slate-400">For security, document portals are valid only for 10 minutes after first login.</p>
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
            This portal is secure and encrypted. Session expires 10 mins after login.
          </p>
        </div>
      </div>
    );
  }

  // Document View (Authenticated)
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600 text-sm font-bold text-white shadow-lg shadow-violet-100">
            S
          </div>
          <div>
            <p className="text-sm font-bold tracking-tight text-slate-900 uppercase">SMARTDOCS</p>
            <div className="flex items-center gap-1.5 text-[10px] text-red-500 font-bold uppercase">
               <Clock className="h-3 w-3" />
               Session Expires In: {timeRemaining}
            </div>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs font-bold text-slate-900">{document?.name}</p>
          <div className="flex items-center justify-end gap-2 text-[10px] text-green-600 font-bold uppercase">
            <ShieldCheck className="h-3 w-3" />
            Verified Access
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-hidden p-6 md:p-8">
        <div className="mx-auto h-full max-w-5xl rounded-[2.5rem] border border-slate-200 bg-white shadow-2xl overflow-hidden flex flex-col">
          <div className="flex-1 overflow-y-auto bg-slate-50 p-6 md:p-12">
             <div className="mx-auto max-w-[800px] bg-white shadow-sm p-12 min-h-full rounded-2xl border border-slate-100">
                {document?.content ? (
                  <div className="prose prose-slate max-w-none" dangerouslySetInnerHTML={{ __html: document.content }} />
                ) : document?.file_url ? (
                  <div className="flex flex-col items-center justify-center py-40">
                    <FileText className="h-16 w-16 text-slate-200 mb-4" />
                    <p className="text-slate-500 font-medium text-center">This document is a PDF. Click sign below to add your digital endorsement.</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-40">
                    <AlertCircle className="h-16 w-16 text-slate-200 mb-4" />
                    <p className="text-slate-500 font-medium">Document content unavailable.</p>
                  </div>
                )}
             </div>
          </div>
          
          <div className="border-t border-slate-100 bg-white/80 backdrop-blur-md p-8">
            <div className="mx-auto max-w-2xl flex flex-col sm:flex-row items-center justify-between gap-6">
              <div className="text-center sm:text-left">
                <p className="text-lg font-bold text-slate-900">Ready to complete?</p>
                <p className="text-sm text-slate-500">By clicking sign, you certify this is your digital signature.</p>
              </div>
              <button 
                onClick={() => setShowSignModal(true)}
                className="flex items-center gap-3 rounded-2xl bg-violet-600 px-10 py-4 text-base font-bold text-white shadow-xl shadow-violet-200 transition-all hover:bg-violet-700 hover:scale-105 active:scale-95"
              >
                <Pen className="h-5 w-5" />
                Sign Document
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Signature Modal */}
      {showSignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl overflow-hidden">
             <div className="flex items-center justify-between p-8 border-b border-slate-100">
                <h3 className="text-xl font-bold text-slate-900 flex items-center gap-3">
                   <Pen className="h-5 w-5 text-violet-600" />
                   Draw Your Signature
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
                   <p className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-slate-300 text-xs font-medium pointer-events-none select-none uppercase tracking-widest opacity-40">
                      Sign Here
                   </p>
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
                   onClick={handleFinalSign}
                   disabled={isSubmitting}
                   className="w-full py-4 rounded-2xl bg-violet-600 text-white font-bold shadow-lg shadow-violet-200 hover:bg-violet-700 active:scale-[0.98] transition-all disabled:opacity-50"
                >
                   {isSubmitting ? "Submitting Signature..." : "Confirm & Sign"}
                </button>
                <p className="text-center text-[10px] text-slate-400">
                  By signing, you agree this is a legally binding electronic representation of your signature.
                </p>
             </div>
          </div>
        </div>
      )}
    </div>
  );
}
