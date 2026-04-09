/* eslint-disable @next/next/no-img-element */
"use client";

import { useRef, useState, useEffect } from "react";
import type React from "react";
import { supabase } from "../../lib/supabase/browser";
import { removeStoredSignature, setStoredSignature } from "../../lib/signature-storage";

type SignatureRow = {
  id: string;
  owner_id: string;
  name: string;
  data_url: string;
};

export default function CreateSignPage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    const loadSignature = async () => {
      const { data } = await supabase.auth.getUser();
      const currentUser = data.user;
      if (!currentUser) return;
      setUserId(currentUser.id);

      const { data: signatureData, error } = await (supabase as any)
        .from("signatures")
        .select("id, owner_id, name, data_url")
        .eq("owner_id", currentUser.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const row = signatureData as SignatureRow | null;

      if (!error && row?.data_url) {
        setSavedSignature(row.data_url);
      }
    };

    loadSignature();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      canvas.width = width * scale;
      canvas.height = height * scale;
      // Reset transform so repeated resizes don't compound scaling.
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.scale(scale, scale);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.lineWidth = 2;
      context.strokeStyle = "#111827";
    };

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  const getPos = (event: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();

    if ("touches" in event) {
      const touch = event.touches[0];
      return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
      };
    }

    return {
      x: (event as React.MouseEvent).clientX - rect.left,
      y: (event as React.MouseEvent).clientY - rect.top,
    };
  };

  const handleStart = (event: React.MouseEvent | React.TouchEvent) => {
    event.preventDefault();
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    const pos = getPos(event);
    if (!canvas || !context || !pos) return;

    context.beginPath();
    context.moveTo(pos.x, pos.y);
    setIsDrawing(true);
  };

  const handleMove = (event: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    event.preventDefault();
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    const pos = getPos(event);
    if (!canvas || !context || !pos) return;

    context.lineTo(pos.x, pos.y);
    context.stroke();
  };

  const handleEnd = (event: React.MouseEvent | React.TouchEvent) => {
    event.preventDefault();
    setIsDrawing(false);
  };

  const handleSaveDrawn = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    if (!userId) {
      setBanner("Please sign in again to save your signature.");
      return;
    }

    supabase
      .from("signatures")
      .insert({
        owner_id: userId,
        name: "My signature",
        data_url: dataUrl,
      })
      .then(({ error }: { error: any }) => {
        if (error) {
          setBanner("Could not save signature to Supabase.");
          return;
        }
        setSavedSignature(dataUrl);
        setStoredSignature(userId, dataUrl);
        setBanner("Saved to Supabase.");
      });
  };

  const handleUploadPick = () => uploadInputRef.current?.click();

  const handleUploadFile = async (file: File) => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });

    if (!userId) {
      setBanner("Please sign in again to save your signature.");
      return;
    }

    const { error } = await supabase.from("signatures").insert({
      owner_id: userId,
      name: file.name.replace(/\.[^/.]+$/, ""),
      data_url: dataUrl,
    });

    if (error) {
      setBanner("Could not save signature to Supabase.");
      return;
    }

    setSavedSignature(dataUrl);
    setStoredSignature(userId, dataUrl);
    setBanner("Uploaded and saved to Supabase.");
  };

  const handleRemoveSaved = () => {
    if (!userId) {
      setBanner("Please sign in again to remove your signature.");
      return;
    }

    supabase
      .from("signatures")
      .delete()
      .eq("owner_id", userId)
      .then(({ error }: { error: any }) => {
        if (error) {
          setBanner("Could not remove signature from Supabase.");
          return;
        }
        setSavedSignature(null);
        removeStoredSignature(userId);
        setBanner("Removed saved signature.");
      });
  };

  return (
    <div className="min-h-full bg-slate-50 px-4 py-6 md:px-10 md:py-10">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            Create sign
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Choose how you want to apply your signature.
          </p>
        </div>

        {banner && (
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
            {banner}
          </div>
        )}

        <section className="grid gap-6 md:grid-cols-12 items-start">
          {/* Left Column: Ways to add signature */}
          <div className="flex flex-col gap-6 md:col-span-7">
            {/* Option 1: Draw signature */}
          </div>

          {/* Right Column: Saved Signature Display */}
          <div className="md:col-span-5 sticky top-24">
            {/* Option 0: My signature */}
            <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-700 shadow-sm flex flex-col h-full min-h-[400px]">
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-base font-bold text-slate-900">
                    My current signature
                  </p>
                  <p className="mt-1 text-xs text-slate-500 leading-relaxed">
                    This signature is saved securely to your account. It will be pre-filled to any document you need to sign in the future.
                  </p>
                </div>
              </div>

              <div className="flex-1 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 flex flex-col items-center justify-center">
                {savedSignature ? (
                  <div className="flex flex-col items-center gap-4 w-full">
                    <div className="flex w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-8 shadow-sm">
                      <img
                        src={savedSignature}
                        alt="Saved signature"
                        className="max-h-24 w-auto max-w-full object-contain drop-shadow-sm"
                      />
                    </div>
                    <p className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
                      Saved and ready to use
                    </p>
                  </div>
                ) : (
                  <div className="text-center flex flex-col items-center gap-3">
                    <div className="h-16 w-16 bg-slate-200 rounded-full flex items-center justify-center text-slate-400">
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-800">
                        No signature configured
                      </p>
                      <p className="mt-1 text-xs text-slate-500 max-w-[200px] mx-auto">
                        Draw or upload your signature on the left to activate this feature.
                      </p>
                    </div>
                  </div>
                )}
              </div>
              
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  className="rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-all disabled:opacity-50"
                  onClick={handleUploadPick}
                >
                  Upload New
                </button>
                <button
                  type="button"
                  className="rounded-full border border-red-200 bg-red-50 px-4 py-2 text-xs font-bold text-red-600 hover:bg-red-100 hover:border-red-300 transition-all disabled:opacity-50 disabled:bg-slate-50 disabled:text-slate-400 disabled:border-slate-200"
                  onClick={handleRemoveSaved}
                  disabled={!savedSignature}
                >
                  Remove Sign
                </button>
              </div>

              <input
                ref={uploadInputRef}
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  handleUploadFile(file).catch(() =>
                    setBanner("Upload failed (demo).")
                  );
                  event.target.value = "";
                }}
              />
            </div>
          </div>
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">
            <div>
              <p className="text-sm font-semibold text-slate-900">
                Option 1 · Draw your signature
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Use your mouse or trackpad to sign in the area below.
              </p>
            </div>
            <div className="flex flex-col items-stretch rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6">
              <div className="h-32 rounded-lg border border-slate-300 bg-white shadow-inner">
                <canvas
                  ref={canvasRef}
                  className="h-full w-full"
                  onMouseDown={handleStart}
                  onMouseMove={handleMove}
                  onMouseUp={handleEnd}
                  onMouseLeave={handleEnd}
                  onTouchStart={handleStart}
                  onTouchMove={handleMove}
                  onTouchEnd={handleEnd}
                />
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                <span>Sign inside the box.</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-full bg-[color:var(--color-brand-primary)] px-3 py-1 text-[11px] font-semibold text-white shadow-sm hover:bg-blue-700"
                    onClick={handleSaveDrawn}
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Option 2: Upload signature image */}
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">
            <div>
              <p className="text-sm font-semibold text-slate-900">
                Option 2 · Upload signature image
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Upload a clear photo or scan of your handwritten signature.
              </p>
            </div>
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
              <div className="mb-4 h-12 w-12 bg-white flex items-center justify-center rounded-full border border-slate-200 text-slate-400 shadow-sm">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
              </div>
              <p className="text-sm font-bold text-slate-800">
                Browse for signature image
              </p>
              <p className="mt-1 text-xs text-slate-500">
                PNG or JPG, recommended size at least 300×80 px.
              </p>
              <button
                type="button"
                className="mt-6 inline-flex items-center justify-center rounded-full bg-violet-600 px-6 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-violet-700 transition-all hover:scale-105 active:scale-95"
                onClick={handleUploadPick}
              >
                Choose File
              </button>
            </div>
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-full bg-violet-600 px-6 py-2 border border-transparent text-xs font-bold text-white shadow-sm hover:bg-violet-700 transition-all"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
