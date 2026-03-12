// Pure utility helpers for block-editor content — no browser APIs, safe to import anywhere

export interface TiptapNode {
  type: string;
  text?: string;
  content?: TiptapNode[];
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

export interface TiptapDoc {
  type: 'doc';
  content: TiptapNode[];
}

/**
 * Parse note_text into a format Tiptap's `content` prop understands.
 * - If it's valid Tiptap JSON → return the parsed object
 * - Otherwise wrap the raw text in a paragraph (legacy plain-text migration)
 */
export function parseNoteContent(noteText: string): TiptapDoc | string {
  if (!noteText || noteText.trim() === '') return '';
  try {
    const parsed = JSON.parse(noteText) as TiptapDoc;
    if (parsed && parsed.type === 'doc' && Array.isArray(parsed.content)) {
      return parsed;
    }
  } catch {
    // not JSON — fall through to plain-text fallback
  }
  // Legacy plain-text: wrap in a single paragraph block
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: noteText }],
      },
    ],
  };
}

/** Walk a Tiptap JSON node tree and collect all text content */
function walkNode(node: TiptapNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  if (!node.content?.length) return '';

  const parts = node.content.map(walkNode);

  // Add a newline between block-level nodes so preview reads naturally
  const blockTypes = new Set([
    'doc', 'paragraph', 'heading', 'bulletList', 'orderedList', 'taskList',
    'listItem', 'taskItem', 'blockquote', 'codeBlock',
  ]);
  const joiner = blockTypes.has(node.type) ? '\n' : '';
  return parts.join(joiner);
}

/**
 * Extract plain text from note_text (JSON or legacy string) for
 * card previews and full-text search.
 */
export function extractPlainText(noteText: string): string {
  if (!noteText) return '';
  try {
    const parsed = JSON.parse(noteText) as TiptapDoc;
    if (parsed && parsed.type === 'doc') {
      return walkNode(parsed as TiptapNode).trim();
    }
  } catch {
    // not JSON — return as-is
  }
  return noteText;
}
