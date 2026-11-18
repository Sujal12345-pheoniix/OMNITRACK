'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, UsersRound } from 'lucide-react';
import type { TeamDetailDto } from '@omnitrack/contracts';
import {
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FormField,
  Input,
  Label,
  PageHeader,
  Select,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  Textarea,
  toast,
} from '@omnitrack/ui';
import { ErrorState, FormAlert, LoadingRows, StatusBadge, useFormState } from '@/components/common';
import { fieldErrors, post } from '@/lib/api';
import { keys, useDepartments, useEmployeeOptions, useTeams } from '@/lib/queries';
import { useCan } from '@/lib/session';
import { useRouter } from 'next/navigation';

function NewTeamDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const departments = useDepartments(false, open);
  const people = useEmployeeOptions(open);
  const { values, bind } = useFormState({ name: '', description: '', departmentId: '', leaderEmployeeId: '' });
  const create = useMutation({
    mutationFn: () => post<TeamDetailDto>('/teams', values),
    onSuccess: async (t) => {
      await qc.invalidateQueries({ queryKey: keys.teams });
      toast({ title: 'Team created', description: t.name });
      router.push(`/teams/${t.id}`);
    },
  });
  const errs = fieldErrors(create.error);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New team</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <FormField label="Name" htmlFor="team-name" required error={errs.name}>
            <Input {...bind('name')} />
          </FormField>
          <FormField label="Department" htmlFor="team-dept" required error={errs.departmentId}>
            <Select {...bind('departmentId')}>
              <option value="">Choose a department</option>
              {departments.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Team leader" htmlFor="team-leader" required error={errs.leaderEmployeeId} hint="The leader is added as a member automatically.">
            <Select {...bind('leaderEmployeeId')}>
              <option value="">Choose a leader</option>
              {people.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Description" htmlFor="team-desc" error={errs.description}>
            <Textarea {...bind('description')} maxLength={500} />
          </FormField>
          {create.error && Object.keys(errs).length === 0 ? <FormAlert error={create.error} /> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending}>
              Create team
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function TeamsPage() {
  const can = useCan();
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const teams = useTeams(showArchived);
  const canCreate = can('team.manage', 'department');

  return (
    <>
      <PageHeader
        title="Teams"
        description="Working groups inside departments. Team leaders see their members' work."
        actions={
          canCreate ? (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" /> New team
            </Button>
          ) : null
        }
      />
      <div className="mb-3 flex items-center gap-2">
        <Checkbox id="teams-archived" checked={showArchived} onCheckedChange={(c) => setShowArchived(c === true)} />
        <Label htmlFor="teams-archived" className="font-normal">
          Show archived
        </Label>
      </div>
      {teams.isPending ? (
        <LoadingRows />
      ) : teams.isError ? (
        <ErrorState error={teams.error} onRetry={() => teams.refetch()} />
      ) : teams.data.length === 0 ? (
        <EmptyState
          icon={<UsersRound />}
          title="No teams yet"
          description="Teams group people inside a department under a leader."
          action={canCreate ? <Button onClick={() => setCreating(true)}>New team</Button> : null}
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <THead>
              <TR>
                <TH>Team</TH>
                <TH>Department</TH>
                <TH>Leader</TH>
                <TH className="text-right">Members</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {teams.data.map((t) => (
                <TR key={t.id}>
                  <TD>
                    <Link href={`/teams/${t.id}`} className="font-medium hover:underline">
                      {t.name}
                    </Link>
                  </TD>
                  <TD>{t.department.name}</TD>
                  <TD>{t.leader.fullName}</TD>
                  <TD className="text-right tabular-nums">{t.memberCount}</TD>
                  <TD>
                    <StatusBadge status={t.status} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
      {creating ? <NewTeamDialog open onOpenChange={setCreating} /> : null}
    </>
  );
}
