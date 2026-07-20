import { createContext, useContext, useState, useCallback, ReactNode, useRef } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react';
import './ToastContext.css';

export type ToastType = 'success' | 'warning' | 'error' | 'info';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const MAX_VISIBLE = 3;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const removeToast = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = 'info', duration = 4000) => {
      setToasts((prev) => {
        const existing = prev.find((t) => t.message === message && t.type === type);
        if (existing) {
          const old = timers.current.get(existing.id);
          if (old) clearTimeout(old);
          timers.current.set(
            existing.id,
            setTimeout(() => removeToast(existing.id), duration),
          );
          return prev;
        }

        const id = nextId.current++;
        timers.current.set(
          id,
          setTimeout(() => removeToast(id), duration),
        );
        const next = [...prev, { id, message, type }];
        if (next.length <= MAX_VISIBLE) return next;
        const dropped = next.slice(0, next.length - MAX_VISIBLE);
        for (const d of dropped) {
          const t = timers.current.get(d.id);
          if (t) {
            clearTimeout(t);
            timers.current.delete(d.id);
          }
        }
        return next.slice(-MAX_VISIBLE);
      });
    },
    [removeToast]
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextType {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}

function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.type}`} onClick={() => onDismiss(toast.id)}>
          <span className="toast-icon">{getToastIcon(toast.type)}</span>
          <span className="toast-message">{toast.message}</span>
          <button className="toast-close" onClick={() => onDismiss(toast.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function getToastIcon(type: ToastType) {
  switch (type) {
    case 'success':
      return <CheckCircle2 size={18} />;
    case 'warning':
      return <AlertTriangle size={18} />;
    case 'error':
      return <XCircle size={18} />;
    case 'info':
    default:
      return <Info size={18} />;
  }
}

export default ToastContext;
