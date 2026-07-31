'use client';

import { useEffect, useId, useRef, type ReactElement, type ReactNode } from 'react';
import { Button } from './button';

type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
};

/**
 * Accessible modal dialog with focus trapping and escape handling.
 *
 * The overlay closes on click outside the panel.
 * Focus is trapped inside the dialog while open.
 * Previous focus is restored on close.
 */
export function Dialog({ open, onClose, title, children, actions }: DialogProps): ReactElement | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      // Prevent background scrolling
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      // Focus the dialog panel after a short delay
      const raf = requestAnimationFrame(() => {
        panelRef.current?.focus();
      });
      return () => {
        cancelAnimationFrame(raf);
        document.body.style.overflow = previousOverflow;
      };
    }
    // Not open: restore focus only. The overflow restore is handled by the
    // cleanup above, so a non-default overflow set elsewhere is preserved.
    previousFocusRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }

      // Trap focus within the dialog
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="dialog-panel"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header">
          <h2 id={titleId} style={{ margin: 0 }}>{title}</h2>
        </div>
        <div className="dialog-body">
          {children}
        </div>
        <div className="dialog-footer">
          {actions}
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
        </div>
      </div>
    </div>
  );
}
