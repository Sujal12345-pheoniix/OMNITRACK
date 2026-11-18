'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useState, type ChangeEvent, type ReactNode } from 'react';
import { Badge, Button, Card, Skeleton } from '@omnitrack/ui';
import { ApiError, errorMessage } from '@/lib/api';
import { STATUS_LABEL, statusVariant } from '@/lib/format';

export function ErrorState({ error, onRetry, title = 'Could not load this page' }: { error: unknown; onRetry?: () => void; title?: string }) {
  const forbidden = error instanceof ApiError && error.status === 403;
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-10 text-center">
      <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />
      <div>
        <p className="font-semibold">{forbidden ? 'You do not have access to this' : title}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {forbidden ? 'Ask an administrator if you need this permission.' : errorMessage(error)}
        </p>
      </div>
      {onRetry && !forbidden ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw aria-hidden="true" /> Try again
        </Button>
      ) : null}
    </div>
  );
}

export function LoadingRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

export function LoadingPage() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-80" />
      <LoadingRows />
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={statusVariant(status)}>{STATUS_LABEL[status] ?? status}</Badge>;
}

export function FormAlert({ error }: { error: unknown }) {
  if (!error) return null;
  // Field-level messages are shown next to fields; show the summary here.
  return (
    <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {errorMessage(error)}
    </p>
  );
}

export function AuthCard({ title, description, children, footer }: { title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <Link href="/" className="mb-6 flex items-center gap-2 text-lg font-semibold tracking-tight">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground" aria-hidden="true">
          O
        </span>
        OmniTrack
      </Link>
      <Card className="w-full max-w-md p-6 sm:p-8">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        <div className="mt-6">{children}</div>
      </Card>
      {footer ? <div className="mt-4 text-sm text-muted-foreground">{footer}</div> : null}
      <p className="mt-8 text-xs text-muted-foreground">Every Action. Every Record. Every Result.</p>
    </main>
  );
}

/** Minimal controlled-form state; validation lives on the server and is mapped back to fields. */
export function useFormState<T extends Record<string, string | boolean>>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const bind = (name: keyof T & string) => ({
    name,
    value: String(values[name] ?? ''),
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setValues((v) => ({ ...v, [name]: e.target.value })),
  });
  return { values, setValues, bind };
}

/** Converts empty strings to null for optional API fields. */
export function nullable(v: string): string | null {
  const t = v.trim();
  return t === '' ? null : t;
}
