'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Building2 } from 'lucide-react';
import { Button, EmptyState, Spinner } from '@omnitrack/ui';
import { ErrorState } from '@/components/common';
import { CreateOrganizationDialog, Shell } from '@/components/shell';
import { ApiError, post } from '@/lib/api';
import { useMe } from '@/lib/session';

/** Signed-in area: resolves the session, enforces MFA enrolment and organization context. */
export default function AppLayout({ children }: { children: ReactNode }) {
  const me = useMe();
  const [creating, setCreating] = useState(false);
  const enrol = me.data?.mfaEnrollmentRequired;

  useEffect(() => {
    if (enrol) window.location.assign('/setup-mfa');
  }, [enrol]);

  if (me.isPending || enrol || (me.error instanceof ApiError && me.error.status === 401)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Loading your workspace" />
      </div>
    );
  }
  if (me.isError) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <ErrorState error={me.error} onRetry={() => me.refetch()} />
      </div>
    );
  }
  if (!me.data.organization) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <EmptyState
          icon={<Building2 />}
          title="You are not part of an active organization"
          description="Create an organization, or ask an administrator to invite you. If your organization was suspended, contact its owner."
          action={
            <div className="flex gap-2">
              <Button onClick={() => setCreating(true)}>Create organization</Button>
              <Button
                variant="outline"
                onClick={async () => {
                  await post('/auth/logout').catch(() => undefined);
                  window.location.assign('/login');
                }}
              >
                Sign out
              </Button>
            </div>
          }
        />
        <CreateOrganizationDialog open={creating} onOpenChange={setCreating} />
      </div>
    );
  }
  return <Shell me={me.data}>{children}</Shell>;
}
