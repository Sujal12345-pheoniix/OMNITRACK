'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@omnitrack/ui';
import { AuthCard } from '@/components/common';
import { MfaSetup } from '@/components/mfa-setup';
import { post } from '@/lib/api';
import { meKey, useMe } from '@/lib/session';

export default function SetupMfaPage() {
  const me = useMe();
  const qc = useQueryClient();
  const required = me.data?.mfaEnrollmentRequired ?? true;

  return (
    <AuthCard
      title="Set up two-factor authentication"
      description={
        required
          ? 'Your role requires a second sign-in step. It protects your organization if your password is ever exposed.'
          : 'Add a second sign-in step to protect your account.'
      }
      footer={
        <Button
          variant="link"
          onClick={async () => {
            await post('/auth/logout').catch(() => undefined);
            window.location.assign('/login');
          }}
        >
          Sign out
        </Button>
      }
    >
      <MfaSetup
        onDone={async () => {
          await qc.invalidateQueries({ queryKey: meKey });
          window.location.assign('/');
        }}
      />
    </AuthCard>
  );
}
