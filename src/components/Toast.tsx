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

const ICONS = { success: "✓", error: "✕", info: "ℹ", warning: "⚠" };
// נגזר מטוקני הנושא כדי שההודעות יתחלפו יחד עם שאר המסך
const mix = (token: string, pct: number) => `color-mix(in srgb, ${token} ${pct}%, var(--tj-surface))`;
const COLORS = {
  success: { bg: mix("var(--tj-mint)", 14),   color: "var(--tj-mint)",   border: mix("var(--tj-mint)", 34) },
  error:   { bg: mix("var(--tj-danger)", 14), color: "var(--tj-danger)", border: mix("var(--tj-danger)", 34) },
  info:    { bg: mix("var(--tj-accent-bright)", 14), color: "var(--tj-accent)", border: mix("var(--tj-accent-bright)", 34) },
  warning: { bg: mix("var(--tj-amber)", 14),  color: "var(--tj-amber)",  border: mix("var(--tj-amber)", 34) },
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
      style={{
        background: c.bg, color: c.color,
        border: `1px solid ${c.border}`,
        padding: "10px 16px", borderRadius: 12,
        fontSize: 14, fontWeight: 500,
        boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
        display: "flex", alignItems: "center", gap: 10,
        minWidth: 240, maxWidth: 480,
        cursor: "pointer", pointerEvents: "auto",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(-20px)",
        transition: "all 0.3s ease",
      }}
    >
      <span style={{
        width: 22, height: 22, borderRadius: "50%",
        background: c.color, color: c.bg,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontWeight: 600, fontSize: 12, flexShrink: 0,
      }}>{ICONS[toast.type]}</span>
      <span style={{ flex: 1 }}>{toast.message}</span>
      {toast.action && (
        <button
          onClick={(e) => { e.stopPropagation(); toast.action!.onClick(); onDismiss(); }}
          style={{
            background: c.color, color: c.bg, border: "none",
            borderRadius: 8, padding: "5px 14px", fontSize: 12.5, fontWeight: 700,
            cursor: "pointer", fontFamily: "inherit", flexShrink: 0,
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
