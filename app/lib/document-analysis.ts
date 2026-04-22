"use client";

let pdfjsLib: typeof import("pdfjs-dist") | null = null;

export type DocumentAnalysis = {
  dataUrl: string;
  textContent: string;
  placeholders: string[];
};

const getPdfJs = async () => {
  if (!pdfjsLib) {
    pdfjsLib = await import("pdfjs-dist");
    if (typeof window !== "undefined") {
      pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
    }
  }
  return pdfjsLib;
};

export const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });

export const extractPlaceholdersFromText = (content: string) => {
  const matches = content.match(/\[([^\]]+)\]|\{([^}]+)\}|\(([^)]+)\)|_{3,}/g);
  if (!matches) return [];
  const normalized = matches.map((item) =>
    item
      .replace(/[\[\](){}]/g, "")
      .replace(/_{3,}/g, "blank field")
      .trim()
  );
  return Array.from(new Set(normalized.filter(Boolean)));
};

export const extractHtmlFromPdf = async (file: File) => {
  const pdfjs = await getPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const numPages = pdf.numPages;
  
  let html = `<div class="pdf-document" style="display: flex; flex-direction: column; gap: 2rem; align-items: center; width: 100%; max-width: 850px; margin: 0 auto;">`;
  
  // Also extract raw text for placeholders
  const chunks: string[] = [];

  for (let pageNumber = 1; pageNumber <= numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (pageText) chunks.push(pageText);

    // High resolution render for HTML output
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (context) {
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: context as any, viewport }).promise;
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85); // JPEG to keep size reasonable
      
      html += `<div class="pdf-page" style="position: relative; width: 100%; background: white; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1); border: 1px solid #e2e8f0;"><img src="${dataUrl}" style="width: 100%; height: auto; display: block;" alt="Page ${pageNumber}" /></div>`;
    }
  }
  
  html += `</div>`;
  return { html, rawText: chunks.join("\n") };
};

export const extractTextFromImage = async (imageSource: string | File) => {
  const { recognize } = await import("tesseract.js");
  const result = await recognize(imageSource, "eng");
  return result.data.text || "";
};

export const convertPdfPageToImage = async (file: File, pageNumber: number = 1) => {
  const pdfjs = await getPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(pageNumber);
  
  const viewport = page.getViewport({ scale: 2.0 }); // Higher scale for better OCR
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  
  if (!context) throw new Error("Could not create canvas context");
  
  canvas.height = viewport.height;
  canvas.width = viewport.width;
  
  const renderTask = page.render({
    canvasContext: context as any,
    viewport: viewport,
  } as any);
  await renderTask.promise;
  
  return canvas.toDataURL("image/png");
};

export const extractTextFromWord = async (file: File) => {
  const mammoth = await import("mammoth");
  const arrayBuffer = await file.arrayBuffer();
  
  // Extract HTML for rendering
  const htmlResult = await mammoth.convertToHtml({ arrayBuffer }, {
    styleMap: [
      "p[style-name='Heading 1'] => h1:fresh",
      "p[style-name='Heading 2'] => h2:fresh",
      "p[style-name='Heading 3'] => h3:fresh",
      "p[style-name='Heading 4'] => h4:fresh",
      "p[style-name='Heading 5'] => h5:fresh",
      "p[style-name='Heading 6'] => h6:fresh",
    ]
  });
  
  // Extract raw text for placeholders
  const rawResult = await mammoth.extractRawText({ arrayBuffer });
  
  // Wrap HTML with basic document styling
  const wrappedHtml = `<div class="word-document" style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e293b; max-width: 850px; margin: 0 auto; padding: 2rem; background: white; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);">${htmlResult.value || ""}</div>`;
  
  return { html: wrappedHtml, rawText: rawResult.value || "" };
};

export const analyzeDocumentFile = async (file: File): Promise<DocumentAnalysis> => {
  const dataUrl = await readFileAsDataUrl(file);

  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    let extracted = await extractHtmlFromPdf(file);
    let htmlContent = extracted.html;
    let rawText = extracted.rawText;
    
    // Fallback to OCR if text extraction is empty or too short (handles scanned PDFs)
    if (rawText.trim().length < 20) {
      console.log("PDF text layer is sparse. Falling back to OCR for placeholders...");
      try {
        const pageImage = await convertPdfPageToImage(file, 1);
        rawText = await extractTextFromImage(pageImage);
      } catch (ocrError) {
        console.error("OCR fallback failed for PDF:", ocrError);
      }
    }
    
    return {
      dataUrl,
      textContent: htmlContent, // Return HTML for rendering
      placeholders: extractPlaceholdersFromText(rawText),
    };
  }

  if (
    file.type === "application/msword" ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.name.toLowerCase().endsWith(".doc") ||
    file.name.toLowerCase().endsWith(".docx")
  ) {
    let htmlContent = "";
    let rawText = "";
    try {
      const extracted = await extractTextFromWord(file);
      htmlContent = extracted.html;
      rawText = extracted.rawText;
    } catch (error) {
      console.error("Word document extraction failed:", error);
    }
    return {
      dataUrl,
      textContent: htmlContent,
      placeholders: extractPlaceholdersFromText(rawText),
    };
  }

  if (
    file.type === "text/plain" ||
    file.type === "text/csv" ||
    file.name.toLowerCase().endsWith(".txt") ||
    file.name.toLowerCase().endsWith(".csv")
  ) {
    const rawText = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Failed to read text file"));
      reader.readAsText(file);
    });

    const htmlContent = `<div class="text-document" style="max-width: 850px; margin: 0 auto; background: white; padding: 2rem; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);"><pre style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; white-space: pre-wrap; word-wrap: break-word; color: #1e293b; font-size: 14px; line-height: 1.6;">${rawText.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre></div>`;

    return {
      dataUrl,
      textContent: htmlContent,
      placeholders: extractPlaceholdersFromText(rawText),
    };
  }

  if (file.type.startsWith("image/")) {
    let textContent = "";
    try {
      textContent = await extractTextFromImage(file);
    } catch (error) {
      console.error("Image OCR failed:", error);
    }
    return {
      dataUrl,
      textContent,
      placeholders: extractPlaceholdersFromText(textContent),
    };
  }

  return {
    dataUrl,
    textContent: "",
    placeholders: [],
  };
};

