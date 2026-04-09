'use client';

import { usePermissions } from '@/contexts/role-permission-context';
import { Eye, X } from 'lucide-react';

export function RolePreviewBanner() {
  const { isPreviewMode, previewRole, exitPreview } = usePermissions();

  if (!isPreviewMode || !previewRole) return null;

  const color = previewRole.color || '#5865F2';

  return (
    <div
      className="sticky top-0 z-[60] flex items-center justify-center gap-3 px-4 py-2 text-sm font-medium text-white shadow-md"
      style={{ backgroundColor: color }}
    >
      <Eye size={16} />
      <span>
        Previewing as <strong>{previewRole.name}</strong> — You are seeing the site as this role would
      </span>
      <button
        onClick={exitPreview}
        className="ml-2 flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold bg-white/20 hover:bg-white/30 transition-colors"
      >
        <X size={14} />
        Exit Preview
      </button>
    </div>
  );
}
