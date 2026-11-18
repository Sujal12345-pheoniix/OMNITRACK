'use client';

import Link from 'next/link';
import type { FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, FormField, Input } from '@omnitrack/ui';
import { AuthCard, FormAlert, useFormState } from '@/components/common';
import { fieldErrors, post } from '@/lib/api';

export default function ForgotPasswordPage() {
  const { values, bind } = useFormState({ email: '' });
  const forgot = useMutation({ mutationFn: () => post<{ message: string }>('/auth/password/forgot', values) });

  return (
    <AuthCard
      title="Reset your password"
      description="Enter your account email. If it exists, we will send a reset link valid for one hour."
      footer={
        <Link className="font-medium text-primary hover:underline" href="/login">
          Back to sign in
        </Link>
      }
    >
      {forgot.isSuccess ? (
        <p role="status" className="text-sm">
          {forgot.data.message}
        </p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            forgot.mutate();
          }}
        >
          <FormField label="Email" htmlFor="email" required error={fieldErrors(forgot.error).email}>
            <Input {...bind('email')} type="email" autoComplete="email" autoFocus />
          </FormField>
          {forgot.error && !fieldErrors(forgot.error).email ? <FormAlert error={forgot.error} /> : null}
          <Button type="submit" className="w-full" loading={forgot.isPending}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
