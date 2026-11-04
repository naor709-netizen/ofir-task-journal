"use client";

import { createContext, useContext, useState, useCallback, useEffect } from "react";

type ToastType = "success" | "error" | "info" | "warning";

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  action?: ToastAction;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType, action?: ToastAction) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) return { toast: (m: string) => alert(m) };
  return ctx;
}

const PATHS: Record<ToastType, string> = {
  success: "m6 12.5 4 4L18 8",
  error: "M7 7l10 10M17 7 7 17",
  info: "M12 11v6M12 7.5v.1",
  warning: "M12 7v6M12 16.5v.1",
};
function ToastIcon({ type }: { type: ToastType }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[type]} />
    </svg>
  );
}
// טוקנים של היומן — עובד גם בבהיר וגם בכהה
const COLORS = {
  success: { tone: "var(--tj-mint, #0B9A76)" },
  error:   { tone: "var(--tj-danger, #D42020)" },
  info:    { tone: "var(--tj-accent, #2563EB)" },
  warning: { tone: "var(--tj-amber, #B45309)" },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, type: ToastType = "info", action?: ToastAction) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t, { id, type, message, action }]);
    setTimeout(() => {
      setToasts(t => t.filter(x => x.id !== id));
    }, action ? 6000 : 4000); // עם כפתור פעולה — זמן להספיק ללחוץ
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div style={{
        position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)",
        zIndex: 9999, display: "flex", flexDirection: "column", gap: 8,
        pointerEvents: "none",
      }}>
        {toasts.map(t => (
          <ToastItem key={t.id} toast={t} onDismiss={() => setToasts(s => s.filter(x => x.id !== t.id))} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [visible, setVisible] = useState(false);
  const c = COLORS[toast.type];

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  return (
    <div
      onClick={onDismiss}
      role="status"
      style={{
        background: "var(--tj-glass, rgba(255,255,255,0.9))", color: "var(--tj-ink, #13223B)",
        backdropFilter: "blur(16px) saturate(1.5)", WebkitBackdropFilter: "blur(16px) saturate(1.5)",
        border: "1px solid var(--tj-line, rgba(23,43,77,0.11))",
        padding: "9px 14px 9px 10px", borderRadius: 16,
        fontSize: 13.5, fontWeight: 500,
        boxShadow: "inset 0 1px 0 var(--tj-bezel, #fff), 0 18px 40px -18px rgba(8,14,28,0.45)",
        display: "flex", alignItems: "center", gap: 10,
        minWidth: 240, maxWidth: "min(480px, calc(100vw - 24px))",
        cursor: "pointer", pointerEvents: "auto",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0) scale(1)" : "translateY(-14px) scale(0.98)",
        transition: "opacity .3s cubic-bezier(0.22,1,0.36,1), transform .4s cubic-bezier(0.22,1,0.36,1)",
      }}
    >
      <span style={{
        width: 24, height: 24, borderRadius: "50%",
        background: `color-mix(in srgb, ${c.tone} 14%, transparent)`, color: c.tone,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontWeight: 700, fontSize: 12, flexShrink: 0,
      }}><ToastIcon type={toast.type} /></span>
      <span style={{ flex: 1 }}>{toast.message}</span>
      {toast.action && (
        <button
          onClick={(e) => { e.stopPropagation(); toast.action!.onClick(); onDismiss(); }}
          style={{
            background: `color-mix(in srgb, ${c.tone} 14%, transparent)`, color: c.tone, border: "none",
            borderRadius: 99, padding: "5px 14px", fontSize: 12.5, fontWeight: 700,
            cursor: "pointer", fontFamily: "inherit", flexShrink: 0,
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
