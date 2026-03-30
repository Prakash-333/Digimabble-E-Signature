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
  const matches = content.match(/\[([^\]]+)\]|\(([^)]+)\)|_{3,}/g);
  if (!matches) return [];
  const normalized = matches.map((item) =>
    item
      .replace(/[\[\]()]/g, "")
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

export const extractTextFromImage = async (file: File) => {
  const { recognize } = await import("tesseract.js");
  const result = await recognize(file, "eng");
  return result.data.text || "";
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
    const textContent = await extractTextFromPdf(file);
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

  if (file.type.startsWith("image/")) {
    let textContent = "";
    try {
      textContent = await extractTextFromImage(file);
    } catch (error) {
      console.error("OCR failed:", error);
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
