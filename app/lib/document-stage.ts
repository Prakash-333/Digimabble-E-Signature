export const DOCUMENT_STAGE_WIDTH = 800;
export const DOCUMENT_STAGE_MIN_HEIGHT = 1056;
export const DOCUMENT_STAGE_PADDING = 64;
export const DOCUMENT_STAGE_FONT_FAMILY =
  'system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';

const POSITIONED_STAGE_MARKER = 'data-smartdocs-stage="positioned-document"';
const STRONG_STYLE_REPLACEMENT = '<strong style="font-weight:700; color:#0f172a;">';

export const renderDocumentStageBodyHtml = (html: string) => {
  if (!html) return "";
  if (
    html.includes('class="pdf-document"') || 
    html.includes('class="word-document"') || 
    html.includes('class="text-document"')
  ) {
    return html;
  }
  return html
    .replace(/\n/g, "<br/>")
    .replace(/<strong>/g, STRONG_STYLE_REPLACEMENT);
};

export const buildPositionedDocumentHtml = (html: string, overlaysHtml: string) =>
  `<div ${POSITIONED_STAGE_MARKER} style="position:relative;width:${DOCUMENT_STAGE_WIDTH}px;min-height:${DOCUMENT_STAGE_MIN_HEIGHT}px;background:#fff;box-sizing:border-box;"><div style="padding:${DOCUMENT_STAGE_PADDING}px;min-height:${DOCUMENT_STAGE_MIN_HEIGHT}px;font-size:15px;color:#1e293b;line-height:1.9;font-family:${DOCUMENT_STAGE_FONT_FAMILY};">${renderDocumentStageBodyHtml(html)}</div>${overlaysHtml}</div>`;

export const hasPositionedDocumentStage = (html: string) =>
  (html || "").includes(POSITIONED_STAGE_MARKER);
