"use client";

import { createContext, useContext, useState, useCallback, useEffect } from "react";

type ToastType = "success" | "error" | "info" | "warning";

interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) return { toast: (m: string) => alert(m) };
  return ctx;
}

const ICONS = { success: "✓", error: "✕", info: "ℹ", warning: "⚠" };
const COLORS = {
  success: { bg: "#DCFCE7", color: "#166534", border: "#86EFAC" },
  error:   { bg: "#FEE2E2", color: "#991B1B", border: "#FCA5A5" },
  info:    { bg: "#DBEAFE", color: "#1E40AF", border: "#93C5FD" },
  warning: { bg: "#FEF3C7", color: "#854D0E", border: "#FCD34D" },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, type: ToastType = "info") => {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t, { id, type, message }]);
    setTimeout(() => {
      setToasts(t => t.filter(x => x.id !== id));
    }, 4000);
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
    </div>
  );
}
