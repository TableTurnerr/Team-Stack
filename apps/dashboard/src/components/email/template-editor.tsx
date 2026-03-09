'use client';

import { useState, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Link as LinkIcon,
  Highlighter,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Minus,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { VariableInserter } from './variable-inserter';
import '@/components/block-editor/block-editor.css';

// ─── Highlight colours ────────────────────────────────────────────────────────

const HIGHLIGHT_COLORS = [
  { label: 'Red',    color: '#fca5a5' },
  { label: 'Orange', color: '#fdba74' },
  { label: 'Yellow', color: '#fde047' },
  { label: 'Green',  color: '#86efac' },
  { label: 'Blue',   color: '#93c5fd' },
  { label: 'Purple', color: '#c4b5fd' },
  { label: 'Pink',   color: '#f9a8d4' },
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface TemplateEditorProps {
  content: string;
  onChange?: (json: string, html: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  editable?: boolean;
  subject?: string;
  onSubjectChange?: (subject: string) => void;
  previewText?: string;
  onPreviewTextChange?: (text: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TemplateEditor({
  content,
  onChange,
  placeholder = "Start writing your email…",
  autoFocus = false,
  editable = true,
  subject,
  onSubjectChange,
  previewText,
  onPreviewTextChange,
}: TemplateEditorProps) {
  const [showColors, setShowColors] = useState(false);

  const parseContent = useCallback((raw: string) => {
    if (!raw) return { type: 'doc', content: [{ type: 'paragraph' }] };
    try {
      return JSON.parse(raw);
    } catch {
      return {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: raw }] }],
      };
    }
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({ placeholder }),
      Link.configure({
        openOnClick: !editable,
        HTMLAttributes: {
          class: 'editor-link',
          rel: 'noopener noreferrer',
          target: '_blank',
        },
      }),
      Underline,
      Highlight.configure({ multicolor: true }),
    ],
    content: parseContent(content) as object,
    autofocus: autoFocus,
    editable,
    editorProps: {
      attributes: {
        class: 'block-editor-content',
        spellcheck: 'true',
      },
    },
    onUpdate({ editor }) {
      if (onChange && editable) {
        onChange(JSON.stringify(editor.getJSON()), editor.getHTML());
      }
    },
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  function handleLink() {
    if (!editor) return;
    const previousUrl = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Enter URL', previousUrl ?? 'https://');
    if (url === null) return;
    if (url.trim() === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }

  function applyHighlight(color: string) {
    if (!editor) return;
    const current = editor.getAttributes('highlight').color as string | undefined;
    if (current === color) {
      editor.chain().focus().unsetHighlight().run();
    } else {
      editor.chain().focus().setHighlight({ color }).run();
    }
  }

  function insertVariable(variable: string) {
    if (!editor) return;
    editor.chain().focus().insertContent(variable).run();
  }

  function insertDivider() {
    if (!editor) return;
    editor.chain().focus().setHorizontalRule().run();
  }

  const activeHighlightColor = editor?.getAttributes('highlight').color as string | undefined;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="template-editor space-y-0">
      {/* Subject line */}
      {onSubjectChange && (
        <div className="border border-[var(--card-border)] rounded-t-lg bg-[var(--card-bg)] px-4 py-3">
          <label className="block text-[10px] font-medium text-[var(--muted)] uppercase tracking-wider mb-1">
            Subject Line
          </label>
          <input
            type="text"
            value={subject || ''}
            onChange={(e) => onSubjectChange(e.target.value)}
            placeholder="Enter email subject…"
            className="w-full text-sm bg-transparent border-none focus:outline-none focus:ring-0 placeholder:text-[var(--muted)]"
            disabled={!editable}
          />
        </div>
      )}

      {/* Preview text */}
      {onPreviewTextChange && (
        <div className="border-x border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-3">
          <label className="block text-[10px] font-medium text-[var(--muted)] uppercase tracking-wider mb-1">
            Preview Text
          </label>
          <input
            type="text"
            value={previewText || ''}
            onChange={(e) => onPreviewTextChange(e.target.value)}
            placeholder="Text shown in inbox preview…"
            className="w-full text-sm bg-transparent border-none focus:outline-none focus:ring-0 placeholder:text-[var(--muted)]"
            maxLength={150}
            disabled={!editable}
          />
          <div className="text-[10px] text-[var(--muted)] mt-1 text-right">
            {(previewText || '').length}/150
          </div>
        </div>
      )}

      {/* Toolbar */}
      {editable && (
        <div className="flex items-center gap-1 px-3 py-2 border border-[var(--card-border)] bg-[var(--card-bg)] flex-wrap">
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleBold().run()}
            className={cn('p-1.5 rounded-md hover:bg-[var(--card-hover)] transition-colors', editor?.isActive('bold') && 'bg-[var(--card-hover)] text-[var(--foreground)]')}
            title="Bold"
          >
            <Bold size={15} />
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleItalic().run()}
            className={cn('p-1.5 rounded-md hover:bg-[var(--card-hover)] transition-colors', editor?.isActive('italic') && 'bg-[var(--card-hover)] text-[var(--foreground)]')}
            title="Italic"
          >
            <Italic size={15} />
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleUnderline().run()}
            className={cn('p-1.5 rounded-md hover:bg-[var(--card-hover)] transition-colors', editor?.isActive('underline') && 'bg-[var(--card-hover)] text-[var(--foreground)]')}
            title="Underline"
          >
            <UnderlineIcon size={15} />
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleStrike().run()}
            className={cn('p-1.5 rounded-md hover:bg-[var(--card-hover)] transition-colors', editor?.isActive('strike') && 'bg-[var(--card-hover)] text-[var(--foreground)]')}
            title="Strikethrough"
          >
            <Strikethrough size={15} />
          </button>

          <div className="w-px h-5 bg-[var(--card-border)] mx-1" />

          <button
            type="button"
            onClick={handleLink}
            className={cn('p-1.5 rounded-md hover:bg-[var(--card-hover)] transition-colors', editor?.isActive('link') && 'bg-[var(--card-hover)] text-[var(--foreground)]')}
            title="Link"
          >
            <LinkIcon size={15} />
          </button>

          <div className="w-px h-5 bg-[var(--card-border)] mx-1" />

          <button
            type="button"
            onClick={() => editor?.chain().focus().setHeading({ level: 1 }).run()}
            className={cn('px-2 py-1 text-xs font-semibold rounded-md hover:bg-[var(--card-hover)] transition-colors', editor?.isActive('heading', { level: 1 }) && 'bg-[var(--card-hover)]')}
            title="Heading 1"
          >
            H1
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().setHeading({ level: 2 }).run()}
            className={cn('px-2 py-1 text-xs font-semibold rounded-md hover:bg-[var(--card-hover)] transition-colors', editor?.isActive('heading', { level: 2 }) && 'bg-[var(--card-hover)]')}
            title="Heading 2"
          >
            H2
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().setHeading({ level: 3 }).run()}
            className={cn('px-2 py-1 text-xs font-semibold rounded-md hover:bg-[var(--card-hover)] transition-colors', editor?.isActive('heading', { level: 3 }) && 'bg-[var(--card-hover)]')}
            title="Heading 3"
          >
            H3
          </button>

          <div className="w-px h-5 bg-[var(--card-border)] mx-1" />

          <button
            type="button"
            onClick={insertDivider}
            className="p-1.5 rounded-md hover:bg-[var(--card-hover)] transition-colors"
            title="Divider"
          >
            <Minus size={15} />
          </button>

          <div className="w-px h-5 bg-[var(--card-border)] mx-1" />

          <VariableInserter onInsert={insertVariable} />
        </div>
      )}

      {/* Editor area */}
      <div className={cn(
        'border border-[var(--card-border)] bg-[var(--card-bg)] min-h-[400px]',
        editable ? 'rounded-b-lg' : 'rounded-lg',
        !onSubjectChange && editable && 'rounded-t-none',
      )}>
        {editor && editable && (
          <BubbleMenu
            editor={editor}
            shouldShow={({ from, to }) => {
              if (from === to) { setShowColors(false); return false; }
              return true;
            }}
          >
            <div className="floating-toolbar-wrap">
              <div className="floating-toolbar">
                <button
                  className={cn('toolbar-btn', editor.isActive('bold') && 'active')}
                  onClick={() => editor.chain().focus().toggleBold().run()}
                  title="Bold"
                >
                  <Bold size={14} strokeWidth={2.5} />
                </button>
                <button
                  className={cn('toolbar-btn', editor.isActive('italic') && 'active')}
                  onClick={() => editor.chain().focus().toggleItalic().run()}
                  title="Italic"
                >
                  <Italic size={14} />
                </button>
                <button
                  className={cn('toolbar-btn', editor.isActive('underline') && 'active')}
                  onClick={() => editor.chain().focus().toggleUnderline().run()}
                  title="Underline"
                >
                  <UnderlineIcon size={14} />
                </button>
                <button
                  className={cn('toolbar-btn', editor.isActive('strike') && 'active')}
                  onClick={() => editor.chain().focus().toggleStrike().run()}
                  title="Strikethrough"
                >
                  <Strikethrough size={14} />
                </button>
                <div className="toolbar-divider" />
                <button
                  className={cn('toolbar-btn', editor.isActive('link') && 'active')}
                  onClick={handleLink}
                  title="Link"
                >
                  <LinkIcon size={14} />
                </button>
                <div className="toolbar-divider" />
                <button
                  className={cn('toolbar-btn toolbar-btn-highlight', showColors && 'active')}
                  onClick={() => setShowColors((v) => !v)}
                  title="Highlight"
                >
                  <Highlighter size={14} />
                  <span
                    className="highlight-indicator"
                    style={{ background: activeHighlightColor ?? 'transparent' }}
                  />
                </button>
              </div>
              {showColors && (
                <div className="color-picker-row">
                  <button
                    className={cn('color-swatch color-swatch-clear', !activeHighlightColor && 'selected')}
                    onClick={() => editor.chain().focus().unsetHighlight().run()}
                    title="Remove highlight"
                  >
                    <X size={11} strokeWidth={2.5} />
                  </button>
                  {HIGHLIGHT_COLORS.map(({ label, color }) => (
                    <button
                      key={color}
                      className={cn('color-swatch', activeHighlightColor === color && 'selected')}
                      style={{ background: color }}
                      onClick={() => applyHighlight(color)}
                      title={label}
                    />
                  ))}
                </div>
              )}
            </div>
          </BubbleMenu>
        )}

        <div className="p-6">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
