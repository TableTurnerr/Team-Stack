'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from 'react';
// In Tiptap 3, Extension + ReactRenderer both come from @tiptap/react
// (@tiptap/core is a transitive dep, not directly installed)
import type { Editor } from '@tiptap/react';
import { ReactRenderer, Extension } from '@tiptap/react';
import Suggestion, { type SuggestionProps, type SuggestionKeyDownProps } from '@tiptap/suggestion';
import {
  Type,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Minus,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Command definitions ──────────────────────────────────────────────────────

interface CommandRange { from: number; to: number }

export interface CommandItem {
  title: string;
  description: string;
  icon: React.ReactNode;
  keywords: string[];
  command: (params: { editor: Editor; range: CommandRange }) => void;
}

const COMMANDS: CommandItem[] = [
  {
    title: 'Text',
    description: 'Start with plain text',
    keywords: ['text', 'paragraph', 'p'],
    icon: <Type size={15} />,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  {
    title: 'Heading 1',
    description: 'Large section heading',
    keywords: ['h1', 'heading', 'title'],
    icon: <Heading1 size={15} />,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run(),
  },
  {
    title: 'Heading 2',
    description: 'Medium section heading',
    keywords: ['h2', 'heading', 'subtitle'],
    icon: <Heading2 size={15} />,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run(),
  },
  {
    title: 'Heading 3',
    description: 'Small section heading',
    keywords: ['h3', 'heading'],
    icon: <Heading3 size={15} />,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run(),
  },
  {
    title: 'Bullet List',
    description: 'Unordered list of items',
    keywords: ['bullet', 'ul', 'list', 'unordered'],
    icon: <List size={15} />,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: 'Numbered List',
    description: 'Ordered list with numbers',
    keywords: ['numbered', 'ol', 'list', 'ordered'],
    icon: <ListOrdered size={15} />,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    title: 'To-Do List',
    description: 'Track tasks with checkboxes',
    keywords: ['todo', 'task', 'checkbox', 'check'],
    icon: <CheckSquare size={15} />,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    title: 'Divider',
    description: 'Horizontal separator line',
    keywords: ['divider', 'hr', 'rule', 'separator', 'line'],
    icon: <Minus size={15} />,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
];

function filterCommands(query: string): CommandItem[] {
  if (!query) return COMMANDS;
  const q = query.toLowerCase();
  return COMMANDS.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      item.keywords.some((k) => k.includes(q)),
  );
}

// ─── Slash menu React component ───────────────────────────────────────────────

interface SlashMenuHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface SlashMenuProps {
  items: CommandItem[];
  command: (item: CommandItem) => void;
}

export const SlashMenu = forwardRef<SlashMenuHandle, SlashMenuProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);

    // Reset selection when filtered list changes
    useEffect(() => setSelectedIndex(0), [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown({ event }) {
        if (event.key === 'ArrowUp') {
          setSelectedIndex((i) => (i - 1 + items.length) % items.length);
          return true;
        }
        if (event.key === 'ArrowDown') {
          setSelectedIndex((i) => (i + 1) % items.length);
          return true;
        }
        if (event.key === 'Enter') {
          const item = items[selectedIndex];
          if (item) command(item);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div className="slash-menu">
          <div className="slash-menu-empty">No results</div>
        </div>
      );
    }

    return (
      <div className="slash-menu">
        <div className="slash-menu-label">BLOCKS</div>
        {items.map((item, index) => (
          <button
            key={item.title}
            className={cn('slash-menu-item', index === selectedIndex && 'selected')}
            onClick={() => command(item)}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <span className="slash-menu-item-icon">{item.icon}</span>
            <div>
              <div className="slash-menu-item-title">{item.title}</div>
              <div className="slash-menu-item-desc">{item.description}</div>
            </div>
          </button>
        ))}
      </div>
    );
  },
);

SlashMenu.displayName = 'SlashMenu';

// ─── Tiptap Extension ─────────────────────────────────────────────────────────

function positionPopup(el: HTMLElement, clientRectFn: (() => DOMRect | null) | null | undefined) {
  const rect = clientRectFn?.();
  if (!rect) return;

  const menuHeight = 320;
  const spaceBelow = window.innerHeight - rect.bottom;
  const top = spaceBelow > menuHeight + 16 ? rect.bottom + 8 : rect.top - menuHeight - 8;
  const left = Math.min(rect.left, window.innerWidth - 280);

  Object.assign(el.style, {
    position: 'fixed',
    top: `${top}px`,
    left: `${Math.max(8, left)}px`,
    zIndex: '9999',
  });
}

export const SlashCommandExtension = Extension.create({
  name: 'slashCommand',

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: '/',
        allowSpaces: false,
        startOfLine: false,
        command: ({ editor, range, props }) => {
          // props is the selected CommandItem (passed via suggestion's command option)
          (props as CommandItem).command({ editor: editor as Editor, range: range as CommandRange });
        },
        items: ({ query }: { query: string }) => filterCommands(query),
        render: () => {
          let component: ReactRenderer<SlashMenuHandle, SlashMenuProps>;

          type SP = SuggestionProps<CommandItem>;

          return {
            onStart(props: SP) {
              component = new ReactRenderer<SlashMenuHandle, SlashMenuProps>(
                SlashMenu,
                {
                  props: {
                    items: props.items,
                    command: (item: CommandItem) => props.command(item),
                  },
                  editor: props.editor,
                },
              );

              document.body.appendChild(component.element);
              positionPopup(component.element, props.clientRect);
            },

            onUpdate(props: SP) {
              component.updateProps({
                items: props.items,
                command: (item: CommandItem) => props.command(item),
              });
              positionPopup(component.element, props.clientRect);
            },

            onKeyDown(props: SuggestionKeyDownProps) {
              if (props.event.key === 'Escape') {
                component.destroy();
                component.element.remove();
                return true;
              }
              return component.ref?.onKeyDown(props) ?? false;
            },

            onExit() {
              component.destroy();
              component.element.remove();
            },
          };
        },
      }),
    ];
  },
});
