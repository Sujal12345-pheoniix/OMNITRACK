'use client';

import * as React from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';
import { cn } from '../cn';

export interface ToastMessage {
  id: number;
  title: string;
  description?: string;
  variant: 'success' | 'error' | 'info';
}

let nextId = 1;
let messages: ToastMessage[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Show a toast from anywhere (event handlers, mutation callbacks). */
export function toast(input: Omit<ToastMessage, 'id' | 'variant'> & { variant?: ToastMessage['variant'] }) {
  const message: ToastMessage = { id: nextId++, ...input, variant: input.variant ?? 'success' };
  messages = [...messages, message].slice(-4);
  emit();
}

function dismiss(id: number) {
  messages = messages.filter((m) => m.id !== id);
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Mount once near the root. Toasts are announced politely to screen readers. */
export function Toaster() {
  const list = React.useSyncExternalStore(
    subscribe,
    () => messages,
    () => messages,
  );
  return (
    <ToastPrimitive.Provider swipeDirection="right" duration={5000}>
      {list.map((m) => (
        <ToastPrimitive.Root
          key={m.id}
          type={m.variant === 'error' ? 'foreground' : 'background'}
          onOpenChange={(open) => !open && dismiss(m.id)}
          className={cn(
            'pointer-events-auto flex w-full items-start gap-3 rounded-lg border bg-surface p-3 pr-8 shadow-lg animate-zoom-in',
            m.variant === 'error' ? 'border-destructive/40' : 'border-border',
          )}
        >
          {m.variant === 'error' ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
          )}
          <div className="grid gap-0.5">
            <ToastPrimitive.Title className="text-sm font-semibold">{m.title}</ToastPrimitive.Title>
            {m.description ? (
              <ToastPrimitive.Description className="text-sm text-muted-foreground">{m.description}</ToastPrimitive.Description>
            ) : null}
          </div>
          <ToastPrimitive.Close className="absolute right-2 top-2 rounded-sm p-1 text-muted-foreground hover:text-foreground" aria-label="Dismiss">
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
      ))}
      <ToastPrimitive.Viewport className="fixed bottom-0 right-0 z-[100] flex max-h-screen w-full flex-col gap-2 p-4 sm:max-w-sm" />
    </ToastPrimitive.Provider>
  );
}
