'use client';

// In Tiptap 3, BubbleMenu moved to the @tiptap/react/menus subpath
import { useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
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
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SlashCommandExtension } from './slash-command';
import { parseNoteContent } from './helpers';
import './block-editor.css';

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

interface BlockEditorProps {
  /** Serialized note content — Tiptap JSON string or legacy plain text */
  content: string;
  /** Called with a Tiptap JSON string whenever content changes */
  onChange?: (content: string) => void;
  /** Placeholder text shown when the editor is empty */
  placeholder?: string;
  /** Whether to auto-focus the editor on mount */
  autoFocus?: boolean;
  /** Set to false for read-only view mode */
  editable?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BlockEditor({
  content,
  onChange,
  placeholder = "Press '/' for commands, or start writing…",
  autoFocus = false,
  editable = true,
}: BlockEditorProps) {
  const [showColors, setShowColors] = useState(false);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: { languageClassPrefix: 'language-' },
      }),
      Placeholder.configure({ placeholder }),
      TaskList,
      TaskItem.configure({ nested: true }),
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
      SlashCommandExtension,
    ],
    content: parseNoteContent(content) as object,
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
        onChange(JSON.stringify(editor.getJSON()));
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

  const activeHighlightColor = editor?.getAttributes('highlight').color as string | undefined;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="block-editor">
      {editor && editable && (
        <BubbleMenu
          editor={editor}
          shouldShow={({ from, to }) => {
            if (from === to) { setShowColors(false); return false; }
            return true;
          }}
        >
          {/* Outer wrapper holds both rows; BubbleMenu sizes to content */}
          <div className="floating-toolbar-wrap">
            {/* ── Row 1: main formatting buttons ── */}
            <div className="floating-toolbar">
              <button
                className={cn('toolbar-btn', editor.isActive('bold') && 'active')}
                onClick={() => editor.chain().focus().toggleBold().run()}
                title="Bold (Ctrl+B)"
              >
                <Bold size={14} strokeWidth={2.5} />
              </button>

              <button
                className={cn('toolbar-btn', editor.isActive('italic') && 'active')}
                onClick={() => editor.chain().focus().toggleItalic().run()}
                title="Italic (Ctrl+I)"
              >
                <Italic size={14} />
              </button>

              <button
                className={cn('toolbar-btn', editor.isActive('underline') && 'active')}
                onClick={() => editor.chain().focus().toggleUnderline().run()}
                title="Underline (Ctrl+U)"
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
                title="Link (Ctrl+K)"
              >
                <LinkIcon size={14} />
              </button>

              <div className="toolbar-divider" />

              {/* Highlight colour picker toggle */}
              <button
                className={cn('toolbar-btn toolbar-btn-highlight', showColors && 'active')}
                onClick={() => setShowColors((v) => !v)}
                title="Highlight colour"
              >
                <Highlighter size={14} />
                {/* Active colour indicator bar */}
                <span
                  className="highlight-indicator"
                  style={{ background: activeHighlightColor ?? 'transparent' }}
                />
              </button>
            </div>

            {/* ── Row 2: colour swatches (only when open) ── */}
            {showColors && (
              <div className="color-picker-row">
                {/* Clear / no colour */}
                <button
                  className={cn('color-swatch color-swatch-clear', !activeHighlightColor && 'selected')}
                  onClick={() => { editor.chain().focus().unsetHighlight().run(); }}
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

      <EditorContent editor={editor} />
    </div>
  );
}
