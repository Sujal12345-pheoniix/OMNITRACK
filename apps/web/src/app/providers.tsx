'use client';

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster, TooltipProvider } from '@omnitrack/ui';
import { useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api';
import { redirectToLogin } from '@/lib/session';

const PUBLIC_PATHS = ['/login', '/signup', '/verify-email', '/forgot-password', '/reset-password', '/accept-invitation'];

/** Session-level failures are handled once, here, for every query and mutation. */
function handleGlobalError(err: unknown) {
  if (!(err instanceof ApiError) || typeof window === 'undefined') return;
  const path = window.location.pathname;
  if (PUBLIC_PATHS.some((p) => path.startsWith(p))) return;
  if (err.status === 401 && err.code !== 'MFA_INVALID' && err.code !== 'LOGIN_REQUIRED') redirectToLogin();
  if (err.status === 403 && err.code === 'MFA_ENROLLMENT_REQUIRED' && path !== '/setup-mfa') window.location.assign('/setup-mfa');
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({ onError: handleGlobalError }),
        mutationCache: new MutationCache({ onError: handleGlobalError }),
        defaultOptions: {
          queries: {
            retry: (count, err) => !(err instanceof ApiError && err.status > 0 && err.status < 500) && count < 2,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        {children}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
