"use client";

let pdfjsLib: typeof import("pdfjs-dist") | null = null;

export type DocumentAnalysis = {
  dataUrl: string;
  textContent: string;
  placeholders: string[];
};

export type PdfPlaceholderOverlay = {
  placeholder: string;
  leftPercent: number;
  topPercent: number;
  widthPercent: number;
  heightPercent: number;
  fontSizePx: number;
};

export type PdfPreviewPage = {
  pageNumber: number;
  imageDataUrl: string;
  width: number;
  height: number;
  overlays: PdfPlaceholderOverlay[];
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

const buildPlaceholderCandidates = (placeholder: string) => {
  const base = placeholder.trim();
  const candidates = [base, `[${base}]`, `{${base}}`, `(${base})`];
  return Array.from(new Set(candidates.map((item) => item.toLowerCase())));
};

const buildOverlayFromMatch = (
  placeholder: string,
  matchedCandidate: string,
  sourceText: string,
  totalWidth: number,
  x: number,
  y: number,
  textHeight: number,
  viewportWidth: number,
  viewportHeight: number
): PdfPlaceholderOverlay => {
  const normalizedSource = sourceText.toLowerCase();
  const matchIndex = normalizedSource.indexOf(matchedCandidate);
  const hasWrappedDelimiters =
    (matchedCandidate.startsWith("[") && matchedCandidate.endsWith("]")) ||
    (matchedCandidate.startsWith("{") && matchedCandidate.endsWith("}")) ||
    (matchedCandidate.startsWith("(") && matchedCandidate.endsWith(")"));
  const innerMatchIndex = hasWrappedDelimiters ? matchIndex + 1 : matchIndex;
  const innerMatchLength = hasWrappedDelimiters
    ? Math.max(matchedCandidate.length - 2, placeholder.length)
    : matchedCandidate.length;
  const widthRatio = sourceText.length > 0 ? innerMatchLength / sourceText.length : 1;
  const leftRatio = sourceText.length > 0 ? innerMatchIndex / sourceText.length : 0;
  const matchWidth = totalWidth * widthRatio;
  const matchLeft = x + totalWidth * leftRatio;
  const top = viewportHeight - y - textHeight;

  return {
    placeholder,
    leftPercent: (matchLeft / viewportWidth) * 100,
    topPercent: (top / viewportHeight) * 100,
    widthPercent: (Math.max(matchWidth, textHeight * 2) / viewportWidth) * 100,
    heightPercent: (Math.max(textHeight, 16) / viewportHeight) * 100,
    fontSizePx: Math.max(textHeight, 12),
  };
};

const buildOcrLineOverlays = async (
  imageDataUrl: string,
  placeholderMatchers: Array<{ placeholder: string; candidates: string[] }>,
  viewportWidth: number,
  viewportHeight: number
): Promise<PdfPlaceholderOverlay[]> => {
  const { recognize } = await import("tesseract.js");
  const result = await recognize(imageDataUrl, "eng");
  const lines = (result.data as any).lines ?? [];
  const words = (result.data as any).words ?? [];
  const overlays: PdfPlaceholderOverlay[] = [];
  const seenPlaceholders = new Set<string>();

  const normalizeToken = (value: string) =>
    value
      .toLowerCase()
      .replace(/[\[\]{}()]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  type OcrWord = {
    text: string;
    bbox?: {
      x0?: number;
      y0?: number;
      x1?: number;
      y1?: number;
    };
  };

  const normalizedWords = (words as OcrWord[])
    .map((word: any) => ({
      raw: String(word.text || ""),
      normalized: normalizeToken(String(word.text || "")),
      bbox: word.bbox,
    }))
    .filter((word: any) => word.normalized);

  placeholderMatchers.forEach(({ placeholder }) => {
    const placeholderTokens = normalizeToken(placeholder).split(/\s+/).filter(Boolean);
    if (!placeholderTokens.length) return;

    for (let index = 0; index <= normalizedWords.length - placeholderTokens.length; index++) {
      const slice = normalizedWords.slice(index, index + placeholderTokens.length);
      const matches = slice.every((word, tokenIndex) => word.normalized === placeholderTokens[tokenIndex]);
      if (!matches) continue;

      const x0 = Math.min(...slice.map((word) => word.bbox?.x0 ?? Number.POSITIVE_INFINITY));
      const y0 = Math.min(...slice.map((word) => word.bbox?.y0 ?? Number.POSITIVE_INFINITY));
      const x1 = Math.max(...slice.map((word) => word.bbox?.x1 ?? 0));
      const y1 = Math.max(...slice.map((word) => word.bbox?.y1 ?? 0));

      if (!Number.isFinite(x0) || !Number.isFinite(y0) || x1 <= x0 || y1 <= y0) {
        continue;
      }

      overlays.push({
        placeholder,
        leftPercent: (x0 / viewportWidth) * 100,
        topPercent: (y0 / viewportHeight) * 100,
        widthPercent: (Math.max(x1 - x0, y1 - y0) / viewportWidth) * 100,
        heightPercent: (Math.max(y1 - y0, 16) / viewportHeight) * 100,
        fontSizePx: Math.max(y1 - y0, 12),
      });
      seenPlaceholders.add(placeholder);
      break;
    }
  });

  lines.forEach((line: any) => {
    const rawText = String(line.text || "");
    const normalizedText = rawText.toLowerCase();
    if (!normalizedText.trim()) return;

    const x0 = line.bbox?.x0 ?? 0;
    const x1 = line.bbox?.x1 ?? x0;
    const y0 = line.bbox?.y0 ?? 0;
    const y1 = line.bbox?.y1 ?? y0;
    const width = Math.max(x1 - x0, 1);
    const height = Math.max(y1 - y0, 1);
    placeholderMatchers.forEach(({ placeholder, candidates }) => {
      if (seenPlaceholders.has(placeholder)) return;
      const matchedCandidate = candidates.find((candidate) => normalizedText.includes(candidate));
      if (!matchedCandidate) return;
      const matchIndex = normalizedText.indexOf(matchedCandidate);
      const hasWrappedDelimiters =
        (matchedCandidate.startsWith("[") && matchedCandidate.endsWith("]")) ||
        (matchedCandidate.startsWith("{") && matchedCandidate.endsWith("}")) ||
        (matchedCandidate.startsWith("(") && matchedCandidate.endsWith(")"));
      const innerMatchIndex = hasWrappedDelimiters ? matchIndex + 1 : matchIndex;
      const innerMatchLength = hasWrappedDelimiters
        ? Math.max(matchedCandidate.length - 2, placeholder.length)
        : matchedCandidate.length;
      const widthRatio = rawText.length > 0 ? innerMatchLength / rawText.length : 1;
      const leftRatio = rawText.length > 0 ? innerMatchIndex / rawText.length : 0;
      const matchWidth = width * widthRatio;
      const matchLeft = x0 + width * leftRatio;

      overlays.push({
        placeholder,
        leftPercent: (matchLeft / viewportWidth) * 100,
        topPercent: (y0 / viewportHeight) * 100,
        widthPercent: (Math.max(matchWidth, height) / viewportWidth) * 100,
        heightPercent: (Math.max(height, 16) / viewportHeight) * 100,
        fontSizePx: Math.max(height, 12),
      });
    });
  });

  return overlays;
};

export const renderPdfPreviewPages = async (
  source: string,
  placeholders: string[] = []
): Promise<PdfPreviewPage[]> => {
  const pdfjs = await getPdfJs();
  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`Failed to fetch PDF preview: ${response.status}`);
  }

  const pdf = await pdfjs.getDocument({ data: await response.arrayBuffer() }).promise;
  const placeholderMatchers = placeholders.map((placeholder) => ({
    placeholder,
    candidates: buildPlaceholderCandidates(placeholder),
  }));

  const pages: PdfPreviewPage[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Could not create canvas context for PDF preview.");
    }

    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: context, viewport } as any).promise;

    const textContent = await page.getTextContent();
    const overlays: PdfPlaceholderOverlay[] = [];
    const textRuns: Array<{
      text: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }> = [];

    textContent.items.forEach((item: any) => {
      if (!("str" in item)) return;

      const rawText = String(item.str || "");
      const normalizedText = rawText.toLowerCase();
      if (!normalizedText.trim()) return;

      const textWidth = typeof item.width === "number" ? item.width : 0;
      const textHeight =
        typeof item.height === "number" && item.height > 0
          ? item.height
          : Math.abs(item.transform?.[0] ?? 16);
      const x = typeof item.transform?.[4] === "number" ? item.transform[4] : 0;
      const y = typeof item.transform?.[5] === "number" ? item.transform[5] : 0;

      textRuns.push({
        text: rawText,
        x,
        y,
        width: textWidth,
        height: textHeight,
      });

      placeholderMatchers.forEach(({ placeholder, candidates }) => {
        const matchedCandidate = candidates.find((candidate) => normalizedText.includes(candidate));
        if (!matchedCandidate) return;
        overlays.push(
          buildOverlayFromMatch(
            placeholder,
            matchedCandidate,
            rawText,
            textWidth,
            x,
            y,
            textHeight,
            viewport.width,
            viewport.height
          )
        );
      });
    });

    if (overlays.length === 0 && textRuns.length > 0) {
      const sortedRuns = [...textRuns].sort((a, b) => {
        if (Math.abs(b.y - a.y) > 3) return b.y - a.y;
        return a.x - b.x;
      });

      const lines: typeof sortedRuns[] = [];
      sortedRuns.forEach((run: any) => {
        const existingLine = lines.find((line: any) => {
          const reference = line[0];
          return Math.abs(reference.y - run.y) <= Math.max(reference.height, run.height) * 0.45;
        });

        if (existingLine) {
          existingLine.push(run);
        } else {
          lines.push([run]);
        }
      });

      lines.forEach((line: any) => {
        const lineRuns = [...line].sort((a, b) => a.x - b.x);
        const lineText = lineRuns.map((run) => run.text).join("");
        const normalizedLineText = lineText.toLowerCase();
        if (!normalizedLineText.trim()) return;

        const segments = lineRuns.map((run) => {
          const start = 0;
          return {
            ...run,
            start,
            end: 0,
          };
        });

        let cursor = 0;
        segments.forEach((segment) => {
          segment.start = cursor;
          cursor += segment.text.length;
          segment.end = cursor;
        });

        const getPositionAtChar = (charIndex: number) => {
          const segment = segments.find((item) => charIndex >= item.start && charIndex <= item.end);
          if (!segment) {
            const last = segments[segments.length - 1];
            return {
              x: last.x + last.width,
              height: last.height,
              y: last.y,
            };
          }

          const localIndex = Math.max(0, Math.min(segment.text.length, charIndex - segment.start));
          const ratio = segment.text.length > 0 ? localIndex / segment.text.length : 0;
          return {
            x: segment.x + segment.width * ratio,
            height: segment.height,
            y: segment.y,
          };
        };

        placeholderMatchers.forEach(({ placeholder, candidates }) => {
          const matchedCandidate = candidates.find((candidate) => normalizedLineText.includes(candidate));
          if (!matchedCandidate) return;

          const matchIndex = normalizedLineText.indexOf(matchedCandidate);
          const hasWrappedDelimiters =
            (matchedCandidate.startsWith("[") && matchedCandidate.endsWith("]")) ||
            (matchedCandidate.startsWith("{") && matchedCandidate.endsWith("}")) ||
            (matchedCandidate.startsWith("(") && matchedCandidate.endsWith(")"));
          const innerMatchIndex = hasWrappedDelimiters ? matchIndex + 1 : matchIndex;
          const innerMatchLength = hasWrappedDelimiters
            ? Math.max(matchedCandidate.length - 2, placeholder.length)
            : matchedCandidate.length;
          const startPos = getPositionAtChar(innerMatchIndex);
          const endPos = getPositionAtChar(innerMatchIndex + innerMatchLength);
          const top = viewport.height - startPos.y - startPos.height;
          const matchWidth = Math.max(endPos.x - startPos.x, startPos.height * 2);

          overlays.push({
            placeholder,
            leftPercent: (startPos.x / viewport.width) * 100,
            topPercent: (top / viewport.height) * 100,
            widthPercent: (matchWidth / viewport.width) * 100,
            heightPercent: (Math.max(startPos.height, 16) / viewport.height) * 100,
            fontSizePx: Math.max(startPos.height, 12),
          });
        });
      });
    }

    if (overlays.length === 0 && placeholderMatchers.length > 0) {
      try {
        const ocrOverlays = await buildOcrLineOverlays(
          canvas.toDataURL("image/png"),
          placeholderMatchers,
          viewport.width,
          viewport.height
        );
        overlays.push(...ocrOverlays);
      } catch (error) {
        console.error(`OCR overlay detection failed for PDF page ${pageNumber}:`, error);
      }
    }

    pages.push({
      pageNumber,
      imageDataUrl: canvas.toDataURL("image/png"),
      width: viewport.width,
      height: viewport.height,
      overlays,
    });
  }

  return pages;
};

export const extractHtmlFromPdf = async (file: File) => {
  const pdfjs = await getPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const numPages = pdf.numPages;
  
  let html = `<div class="pdf-document" style="display: flex; flex-direction: column; gap: 0; align-items: stretch; width: 100%; margin: 0; padding: 0;">`;
  
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
      await page.render({ canvasContext: context, viewport } as any).promise;
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85); // JPEG to keep size reasonable
      
      html += `<div class="pdf-page" style="position: relative; width: 100%; margin: 0 0 24px 0; background: white; border: 1px solid #e2e8f0; box-shadow: none; overflow: hidden;"><img src="${dataUrl}" style="width: 100%; height: auto; display: block; margin: 0;" alt="Page ${pageNumber}" /></div>`;
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
    canvasContext: context,
    viewport,
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
  const wrappedHtml = `<div class="word-document" style="font-family: Arial, sans-serif; line-height: 1.8; color: #1e293b; width: 100%; margin: 0; padding: 0; background: white;">${htmlResult.value || ""}</div>`;
  
  return { html: wrappedHtml, rawText: rawResult.value || "" };
};

export const analyzeDocumentFile = async (file: File): Promise<DocumentAnalysis> => {
  const dataUrl = await readFileAsDataUrl(file);

  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const extracted = await extractHtmlFromPdf(file);
    const htmlContent = extracted.html;
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

    const htmlContent = `<div class="text-document" style="width: 100%; margin: 0; padding: 0; background: white;"><pre style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; white-space: pre-wrap; word-wrap: break-word; color: #1e293b; font-size: 14px; line-height: 1.7; margin: 0;">${rawText.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre></div>`;

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
