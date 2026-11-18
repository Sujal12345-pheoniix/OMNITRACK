'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, FormField, Input } from '@omnitrack/ui';
import { AuthCard, FormAlert, useFormState } from '@/components/common';
import { fieldErrors, post } from '@/lib/api';

function ResetForm() {
  const token = useSearchParams().get('token') ?? '';
  const { values, bind } = useFormState({ password: '', confirm: '' });
  const [mismatch, setMismatch] = useState(false);
  const reset = useMutation({ mutationFn: () => post('/auth/password/reset', { token, password: values.password }) });

  if (reset.isSuccess) {
    return (
      <AuthCard title="Password changed" description="All your other sessions were signed out. Sign in with your new password.">
        <Button asChild className="w-full">
          <Link href="/login">Sign in</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password">
      <form
        className="space-y-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (values.password !== values.confirm) return setMismatch(true);
          setMismatch(false);
          reset.mutate();
        }}
      >
        <FormField label="New password" htmlFor="password" required error={fieldErrors(reset.error).password} hint="At least 12 characters.">
          <Input {...bind('password')} type="password" autoComplete="new-password" autoFocus />
        </FormField>
        <FormField label="Confirm new password" htmlFor="confirm" required error={mismatch ? 'Passwords do not match' : undefined}>
          <Input {...bind('confirm')} type="password" autoComplete="new-password" />
        </FormField>
        {reset.error && !fieldErrors(reset.error).password ? <FormAlert error={reset.error} /> : null}
        <Button type="submit" className="w-full" loading={reset.isPending} disabled={!token}>
          Change password
        </Button>
      </form>
    </AuthCard>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
