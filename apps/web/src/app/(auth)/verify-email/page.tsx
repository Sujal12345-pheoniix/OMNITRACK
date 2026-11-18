'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { Button, Spinner } from '@omnitrack/ui';
import { AuthCard, FormAlert } from '@/components/common';
import { post } from '@/lib/api';

function Verify() {
  const token = useSearchParams().get('token') ?? '';
  const verify = useMutation({ mutationFn: () => post('/auth/email/verify', { token }) });
  const started = useRef(false);

  useEffect(() => {
    // Tokens are single use: guard against React strict-mode double effects.
    if (started.current || !token) return;
    started.current = true;
    verify.mutate();
  }, [token, verify]);

  if (!token) {
    return (
      <AuthCard title="Verification link incomplete" description="Open the link from your email again, or request a new one from the sign-in page.">
        <Button asChild variant="outline">
          <Link href="/login">Go to sign in</Link>
        </Button>
      </AuthCard>
    );
  }
  if (verify.isSuccess) {
    return (
      <AuthCard title="Email verified" description="Your address is confirmed. You can sign in now.">
        <div className="flex flex-col items-center gap-4">
          <CheckCircle2 className="h-10 w-10 text-success" aria-hidden="true" />
          <Button asChild className="w-full">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }
  if (verify.isError) {
    return (
      <AuthCard title="Could not verify your email">
        <div className="space-y-4">
          <FormAlert error={verify.error} />
          <Button asChild variant="outline">
            <Link href="/login">Go to sign in</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Verifying your email">
      <Spinner label="Verifying" />
    </AuthCard>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <Verify />
    </Suspense>
  );
}
