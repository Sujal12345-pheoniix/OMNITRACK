'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { MailCheck } from 'lucide-react';
import { Button, FormField, Input } from '@omnitrack/ui';
import { AuthCard, FormAlert, useFormState } from '@/components/common';
import { fieldErrors, post } from '@/lib/api';

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export default function SignupPage() {
  const { values, setValues, bind } = useFormState({
    displayName: '',
    email: '',
    password: '',
    organizationName: '',
    organizationSlug: '',
  });
  const [slugEdited, setSlugEdited] = useState(false);
  const signup = useMutation({ mutationFn: () => post('/auth/signup', values) });
  const errs = fieldErrors(signup.error);

  if (signup.isSuccess) {
    return (
      <AuthCard title="Check your email" description={`We sent a verification link to ${values.email}.`}>
        <div className="flex flex-col items-center gap-3 text-center text-sm text-muted-foreground">
          <MailCheck className="h-10 w-10 text-primary" aria-hidden="true" />
          <p>Open the link to verify your address, then sign in. The link expires in 24 hours.</p>
          <Button asChild variant="outline" className="mt-2">
            <Link href="/login">Go to sign in</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create your organization"
      description="Set up OmniTrack for your company. You will be its owner."
      footer={
        <>
          Already have an account? <Link className="font-medium text-primary hover:underline" href="/login">Sign in</Link>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          signup.mutate();
        }}
      >
        <FormField label="Your name" htmlFor="displayName" required error={errs.displayName}>
          <Input {...bind('displayName')} autoComplete="name" autoFocus />
        </FormField>
        <FormField label="Work email" htmlFor="email" required error={errs.email}>
          <Input {...bind('email')} type="email" autoComplete="email" />
        </FormField>
        <FormField label="Password" htmlFor="password" required error={errs.password} hint="At least 12 characters. A memorable passphrase works well.">
          <Input {...bind('password')} type="password" autoComplete="new-password" />
        </FormField>
        <FormField label="Organization name" htmlFor="organizationName" required error={errs.organizationName}>
          <Input
            {...bind('organizationName')}
            onChange={(e) => {
              const name = e.target.value;
              setValues((v) => ({ ...v, organizationName: name, organizationSlug: slugEdited ? v.organizationSlug : toSlug(name) }));
            }}
            autoComplete="organization"
          />
        </FormField>
        <FormField
          label="Organization address"
          htmlFor="organizationSlug"
          required
          error={errs.organizationSlug}
          hint="Lowercase letters, digits and hyphens. Used in your careers page URL."
        >
          <Input
            {...bind('organizationSlug')}
            onChange={(e) => {
              setSlugEdited(true);
              setValues((v) => ({ ...v, organizationSlug: e.target.value }));
            }}
          />
        </FormField>
        {signup.error && Object.keys(errs).length === 0 ? <FormAlert error={signup.error} /> : null}
        <Button type="submit" className="w-full" loading={signup.isPending}>
          Create organization
        </Button>
      </form>
    </AuthCard>
  );
}
