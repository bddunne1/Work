// Short messages that don't block the page (C-01): what alert() used to
// do, without stopping the app until someone clicks OK. Any code can call
// showToast; ToastHost (components/Toast.tsx, mounted once in Layout) shows
// them for a few seconds, newest at the bottom.
export type ToastKind = "info" | "error" | "success";

export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

type Listener = (toasts: Toast[]) => void;
let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(toasts);
}

export function showToast(message: string, kind: ToastKind = "info", ms = 6000): void {
  const id = nextId++;
  toasts = [...toasts, { id, message, kind }];
  emit();
  setTimeout(() => dismissToast(id), ms);
}

export function dismissToast(id: number): void {
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener(toasts);
  return () => {
    listeners.delete(listener);
  };
}
