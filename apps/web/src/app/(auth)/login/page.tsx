'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { LoginResponse } from '@omnitrack/contracts';
import { Button, FormField, Input } from '@omnitrack/ui';
import { AuthCard, FormAlert, useFormState } from '@/components/common';
import { ApiError, fieldErrors, post } from '@/lib/api';
import { safeReturnTo } from '@/lib/session';

function LoginForm() {
  const params = useSearchParams();
  const returnTo = safeReturnTo(params.get('returnTo'));
  const [stage, setStage] = useState<'password' | 'mfa'>('password');
  const { values, bind } = useFormState({ email: '', password: '', code: '' });
  const [resent, setResent] = useState(false);

  const done = (r: LoginResponse) => {
    // A full navigation guarantees every cached query is rebuilt for the new session.
    window.location.assign(r.mfaEnrollmentRequired ? '/setup-mfa' : returnTo);
  };

  const login = useMutation({
    mutationFn: () => post<LoginResponse>('/auth/login', { email: values.email, password: values.password }),
    onSuccess: (r) => (r.mfaRequired ? setStage('mfa') : done(r)),
  });
  const mfa = useMutation({
    mutationFn: () => post<LoginResponse>('/auth/mfa/verify', { code: values.code.trim() }),
    onSuccess: done,
  });
  const resend = useMutation({
    mutationFn: () => post('/auth/email/resend', { email: values.email }),
    onSuccess: () => setResent(true),
  });

  const unverified = login.error instanceof ApiError && login.error.code === 'EMAIL_NOT_VERIFIED';

  if (stage === 'mfa') {
    return (
      <AuthCard title="Two-factor authentication" description="Enter the 6-digit code from your authenticator app, or one of your recovery codes.">
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            mfa.mutate();
          }}
        >
          <FormField label="Authentication code" htmlFor="code" required error={fieldErrors(mfa.error).code}>
            <Input {...bind('code')} inputMode="text" autoComplete="one-time-code" autoFocus placeholder="123456" />
          </FormField>
          {mfa.error && !fieldErrors(mfa.error).code ? <FormAlert error={mfa.error} /> : null}
          <Button type="submit" className="w-full" loading={mfa.isPending}>
            Verify
          </Button>
          <Button type="button" variant="link" className="w-full" onClick={() => window.location.assign('/login')}>
            Use a different account
          </Button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Sign in"
      description="Welcome back. Sign in to your organization."
      footer={
        <>
          New to OmniTrack? <Link className="font-medium text-primary hover:underline" href="/signup">Create an organization</Link>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          login.mutate();
        }}
      >
        <FormField label="Email" htmlFor="email" required error={fieldErrors(login.error).email}>
          <Input {...bind('email')} type="email" autoComplete="username" autoFocus />
        </FormField>
        <FormField label="Password" htmlFor="password" required error={fieldErrors(login.error).password}>
          <Input {...bind('password')} type="password" autoComplete="current-password" />
        </FormField>
        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-sm font-medium text-primary hover:underline">
            Forgot password?
          </Link>
        </div>
        {login.error && Object.keys(fieldErrors(login.error)).length === 0 ? <FormAlert error={login.error} /> : null}
        {unverified ? (
          <div className="text-sm">
            {resent ? (
              <p className="text-muted-foreground" role="status">If that address is waiting for verification, a new link is on its way.</p>
            ) : (
              <Button type="button" variant="outline" size="sm" loading={resend.isPending} onClick={() => resend.mutate()}>
                Resend verification email
              </Button>
            )}
          </div>
        ) : null}
        <Button type="submit" className="w-full" loading={login.isPending}>
          Sign in
        </Button>
      </form>
    </AuthCard>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
