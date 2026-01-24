import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(date: string | Date): string {
  return new Date(date).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function timeAgo(date: string | Date): string {
  const now = new Date();
  const then = new Date(date);
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return formatDate(date);
}

export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

/**
 * Sanitize a value for use in PocketBase filter strings.
 * Prevents filter injection attacks by escaping special characters.
 *
 * @param value - The raw user input to sanitize
 * @returns Sanitized string safe for use in filter expressions
 */
export function sanitizeFilterValue(value: string): string {
  if (!value) return '';

  // Escape double quotes and backslashes which can break filter syntax
  let sanitized = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  // Remove potentially dangerous filter operators that could be injected
  // These could allow filter bypass: && || ! ( ) ~ = != > >= < <=
  sanitized = sanitized.replace(/[&|!()~=<>]/g, '');

  return sanitized;
}