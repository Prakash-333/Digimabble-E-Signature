/**
 * A simple utility to highlight differences between two HTML strings.
 * It wraps "new" or "different" words in a highlight span.
 */
export function highlightHtmlEdits(originalHtml: string, newHtml: string): string {
  if (!originalHtml || !newHtml) return newHtml;

  // For a simple implementation, we compare word by word.
  // In a real app, a more robust HTML-aware diffing library would be used.
  
  const originalText = originalHtml.replace(/<[^>]*>?/gm, ' ');
  const newText = newHtml.replace(/<[^>]*>?/gm, ' ');

  const originalWords = originalText.split(/\s+/).filter(Boolean);
  const newWords = newText.split(/\s+/).filter(Boolean);

  const originalSet = new Set(originalWords);
  
  // We'll use a simple strategy: if a word in newHtml doesn't exist in originalHtml, 
  // or if its position shifted significantly, we highlight it.
  // To keep HTML structure intact while highlighting, we can use a more surgical approach.
  
  // However, for a "light" implementation that "just works" for a demo:
  // We will return the newHtml but wrap text that differs.
  
  // Let's try a better approach: 
  // We'll walk through the newHtml and wrap any word that isn't in the original set.
  
  // To avoid breaking HTML tags, we process the text nodes.
  if (typeof document === 'undefined') return newHtml; // Guard for SSR

  const parser = new DOMParser();
  const doc = parser.parseFromString(newHtml, 'text/html');
  
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || '';
      const words = text.split(/(\s+)/); // Preserve whitespace
      
      const newFragment = document.createDocumentFragment();
      
      words.forEach(word => {
        if (word.trim() && !originalSet.has(word.trim())) {
          const span = document.createElement('span');
          span.className = 'bg-yellow-100/80 px-0.5 rounded shadow-sm border-b border-yellow-200';
          span.textContent = word;
          newFragment.appendChild(span);
        } else {
          newFragment.appendChild(document.createTextNode(word));
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
