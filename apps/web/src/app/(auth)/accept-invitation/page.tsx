'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { InvitationPreviewDto } from '@omnitrack/contracts';
import { Button, FormField, Input, Spinner } from '@omnitrack/ui';
import { AuthCard, FormAlert, useFormState } from '@/components/common';
import { ApiError, fieldErrors, post } from '@/lib/api';

function Accept() {
  const token = useSearchParams().get('token') ?? '';
  const preview = useQuery({
    queryKey: ['invitation-preview', token],
    queryFn: () => post<InvitationPreviewDto>('/invitations/preview', { token }),
    enabled: token.length >= 20,
    retry: false,
  });
  const { values, bind } = useFormState({ displayName: '', password: '' });
  const accept = useMutation({
    mutationFn: () =>
      post('/invitations/accept', preview.data?.accountExists ? { token } : { token, displayName: values.displayName, password: values.password }),
    onSuccess: () => window.location.assign('/'),
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'LOGIN_REQUIRED') {
        window.location.assign(`/login?returnTo=${encodeURIComponent(`/accept-invitation?token=${token}`)}`);
      }
    },
  });

  if (!token || preview.isError) {
    return (
      <AuthCard title="Invitation not valid" description="This invitation is invalid, expired or has already been used. Ask the person who invited you to send a new one.">
        <Button asChild variant="outline">
          <Link href="/login">Go to sign in</Link>
        </Button>
      </AuthCard>
    );
  }
  if (!preview.data) {
    return (
      <AuthCard title="Checking your invitation">
        <Spinner label="Checking invitation" />
      </AuthCard>
    );
  }
  const inv = preview.data;
  const errs = fieldErrors(accept.error);

  return (
    <AuthCard title={`Join ${inv.organizationName}`} description={`You have been invited as ${inv.roleName}, using ${inv.email}.`}>
      <form
        className="space-y-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          accept.mutate();
        }}
      >
        {inv.accountExists ? (
          <p className="text-sm text-muted-foreground">
            You already have an OmniTrack account. If you are not signed in as {inv.email}, we will ask you to sign in first.
          </p>
        ) : (
          <>
            <FormField label="Your name" htmlFor="displayName" required error={errs.displayName}>
              <Input {...bind('displayName')} autoComplete="name" autoFocus />
            </FormField>
            <FormField label="Choose a password" htmlFor="password" required error={errs.password} hint="At least 12 characters.">
              <Input {...bind('password')} type="password" autoComplete="new-password" />
            </FormField>
          </>
        )}
        {accept.error && Object.keys(errs).length === 0 ? <FormAlert error={accept.error} /> : null}
        <Button type="submit" className="w-full" loading={accept.isPending}>
          Accept invitation
        </Button>
      </form>
    </AuthCard>
  );
}

export default function AcceptInvitationPage() {
  return (
    <Suspense>
      <Accept />
    </Suspense>
  );
}
