'use client';

import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  Select,
  toast,
} from '@omnitrack/ui';
import { FormAlert } from './common';
import { fieldErrors, post } from '@/lib/api';
import { keys, useRoles } from '@/lib/queries';

/** Invite a person (optionally linked to an existing employee record) with one role. */
export function InviteDialog({
  open,
  onOpenChange,
  employee,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  employee?: { id: string; email: string };
}) {
  const qc = useQueryClient();
  const roles = useRoles(open);
  const [email, setEmail] = useState(employee?.email ?? '');
  const [roleId, setRoleId] = useState('');
  const effectiveRole = roleId || roles.data?.find((r) => r.key === 'employee')?.id || '';
  const invite = useMutation({
    mutationFn: () => post('/invitations', { email, roleId: effectiveRole, ...(employee ? { employeeId: employee.id } : {}) }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: keys.invitations });
      toast({ title: 'Invitation sent', description: `${email} will receive a link valid for 7 days.` });
      onOpenChange(false);
    },
  });
  const errs = fieldErrors(invite.error);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite to OmniTrack</DialogTitle>
          <DialogDescription>They will receive an email to set a password and join with the selected role.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            invite.mutate();
          }}
        >
          <FormField label="Email" htmlFor="invite-email" required error={errs.email}>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          </FormField>
          <FormField label="Role" htmlFor="invite-role" required error={errs.roleId} hint="You can only grant roles whose permissions you hold.">
            <Select value={effectiveRole} onChange={(e) => setRoleId(e.target.value)}>
              {roles.data?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </FormField>
          {invite.error && Object.keys(errs).length === 0 ? <FormAlert error={invite.error} /> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={invite.isPending} disabled={!effectiveRole}>
              Send invitation
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
