/**
 * A simple utility to highlight differences between two HTML strings.
 * It wraps "new" or "different" words in a highlight span.
 */
export function highlightHtmlEdits(originalHtml: string, newHtml: string): string {
  if (!originalHtml || !newHtml) return newHtml;
  if (typeof document === 'undefined') return newHtml; // Guard for SSR

  // Pre-process HTML to ensure block elements and breaks have spaces around them
  // This prevents `textContent` from mashing words together at line breaks (e.g., "paid<br>on")
  const spacedHtml = originalHtml
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?(div|p|h[1-6]|li|ul|tr|td|th|section|article)[^>]*>/gi, ' ');

  // Use DOM to extract clean text and decode entities from original HTML
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = spacedHtml;
  const originalText = tempDiv.textContent || '';

  /**
   * Granular tokenizer: splits by whitespace and individual punctuation characters.
   * This prevents punctuation from "sticking" to words and causing false misses.
   */
  const tokenize = (text: string) => text.split(/(\s+|[^\w\s])/).filter(t => t && t.trim());
  const originalSet = new Set(tokenize(originalText));
  
  const parser = new DOMParser();
  const doc = parser.parseFromString(newHtml, 'text/html');
  
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || '';
      // Split the new text using the same granular logic to identify new tokens
      const segments = text.split(/(\s+|[^\w\s])/); 
      
      const newFragment = document.createDocumentFragment();
      
      segments.forEach(segment => {
        if (!segment) return;
        
        // Always preserve whitespace exactly as it is
        if (/^\s+$/.test(segment)) {
          newFragment.appendChild(document.createTextNode(segment));
          return;
        }

        // Check if this specific token (word or single punctuation) exists in the original
        if (segment.trim() && !originalSet.has(segment.trim())) {
          const span = document.createElement('span');
          span.className = 'bg-yellow-100/80 px-0.5 rounded shadow-sm border-b border-yellow-200';
          span.textContent = segment;
          newFragment.appendChild(span);
        } else {
          newFragment.appendChild(document.createTextNode(segment));
        }
      });
      
      if (node.parentNode) {
        node.parentNode.replaceChild(newFragment, node);
      }
    } else {
      const children = Array.from(node.childNodes);
      children.forEach(walk);
    }
  };

  walk(doc.body);
  return doc.body.innerHTML;
}

