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

export const extractTextFromPdf = async (file: File) => {
  const pdfjs = await getPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const maxPages = Math.min(pdf.numPages, 8);
  const chunks: string[] = [];

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (pageText) {
      chunks.push(pageText);
    }
  }

  return chunks.join("\n");
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
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value || "";
};

export const analyzeDocumentFile = async (file: File): Promise<DocumentAnalysis> => {
  const dataUrl = await readFileAsDataUrl(file);

  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    let textContent = await extractTextFromPdf(file);
    
    // Fallback to OCR if text extraction is empty or too short (handles scanned PDFs)
    if (textContent.trim().length < 20) {
      console.log("PDF text layer is sparse. Falling back to OCR...");
      try {
        // Convert the first page to an image for OCR
        const pageImage = await convertPdfPageToImage(file, 1);
        textContent = await extractTextFromImage(pageImage);
      } catch (ocrError) {
        console.error("OCR fallback failed for PDF:", ocrError);
      }
    }
    
    return {
      dataUrl,
      textContent,
      placeholders: extractPlaceholdersFromText(textContent),
    };
  }

  if (
    file.type === "application/msword" ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.name.toLowerCase().endsWith(".doc") ||
    file.name.toLowerCase().endsWith(".docx")
  ) {
    let textContent = "";
    try {
      textContent = await extractTextFromWord(file);
    } catch (error) {
      console.error("Word document text extraction failed:", error);
    }
    return {
      dataUrl,
      textContent,
      placeholders: extractPlaceholdersFromText(textContent),
    };
  }

  if (
    file.type === "text/plain" ||
    file.type === "text/csv" ||
    file.name.toLowerCase().endsWith(".txt") ||
    file.name.toLowerCase().endsWith(".csv")
  ) {
    const textContent = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Failed to read text file"));
      reader.readAsText(file);
    });

    return {
      dataUrl,
      textContent,
      placeholders: extractPlaceholdersFromText(textContent),
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

