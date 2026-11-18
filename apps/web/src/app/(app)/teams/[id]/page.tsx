'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Pencil, RotateCcw, UserMinus, UserPlus } from 'lucide-react';
import type { TeamDetailDto } from '@omnitrack/contracts';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FormField,
  Input,
  PageHeader,
  Select,
  Textarea,
  toast,
} from '@omnitrack/ui';
import { ErrorState, FormAlert, LoadingPage, StatusBadge, useFormState } from '@/components/common';
import { del, errorMessage, fieldErrors, get, patch, post } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { keys, useEmployeeOptions } from '@/lib/queries';
import { useCan, useMe } from '@/lib/session';

function EditTeamDialog({ team, onClose, leaderOnly }: { team: TeamDetailDto; onClose: () => void; leaderOnly: boolean }) {
  const qc = useQueryClient();
  const people = useEmployeeOptions(!leaderOnly);
  const { values, bind } = useFormState({ name: team.name, description: team.description, leaderEmployeeId: team.leader.id });
  const save = useMutation({
    mutationFn: () =>
      patch<TeamDetailDto>(`/teams/${team.id}`, {
        name: values.name,
        description: values.description,
        ...(leaderOnly ? {} : { leaderEmployeeId: values.leaderEmployeeId }),
        version: team.version,
      }),
    onSuccess: async (t) => {
      qc.setQueryData(['teams', t.id], t);
      await qc.invalidateQueries({ queryKey: keys.teams });
      toast({ title: 'Team updated' });
      onClose();
    },
  });
  const errs = fieldErrors(save.error);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit team</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <FormField label="Name" htmlFor="et-name" required error={errs.name}>
            <Input {...bind('name')} />
          </FormField>
          {!leaderOnly ? (
            <FormField label="Team leader" htmlFor="et-leader" required error={errs.leaderEmployeeId}>
              <Select {...bind('leaderEmployeeId')}>
                {people.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                  </option>
                ))}
              </Select>
            </FormField>
          ) : null}
          <FormField label="Description" htmlFor="et-desc" error={errs.description}>
            <Textarea {...bind('description')} maxLength={500} />
          </FormField>
          {save.error && Object.keys(errs).length === 0 ? <FormAlert error={save.error} /> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function TeamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const me = useMe();
  const qc = useQueryClient();
  const team = useQuery({ queryKey: ['teams', id], queryFn: () => get<TeamDetailDto>(`/teams/${id}`) });
  const people = useEmployeeOptions();
  const [adding, setAdding] = useState('');
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState<{ employeeId: string; fullName: string } | null>(null);
  const [archiving, setArchiving] = useState(false);

  const refresh = (t: TeamDetailDto) => {
    qc.setQueryData(['teams', id], t);
    void qc.invalidateQueries({ queryKey: keys.teams });
    void qc.invalidateQueries({ queryKey: keys.employees });
  };
  const add = useMutation({
    mutationFn: () => post<TeamDetailDto>(`/teams/${id}/members`, { employeeId: adding }),
    onSuccess: (t) => {
      refresh(t);
      setAdding('');
      toast({ title: 'Member added' });
    },
  });
  const remove = useMutation({
    mutationFn: (employeeId: string) => del<TeamDetailDto>(`/teams/${id}/members/${employeeId}`),
    onSuccess: (t) => {
      refresh(t);
      setRemoving(null);
      toast({ title: 'Member removed' });
    },
  });
  const setStatus = useMutation({
    mutationFn: (action: 'archive' | 'restore') => post<TeamDetailDto>(`/teams/${id}/${action}`),
    onSuccess: (t) => {
      refresh(t);
      setArchiving(false);
      toast({ title: t.status === 'archived' ? 'Team archived' : 'Team restored' });
    },
  });

  if (team.isPending) return <LoadingPage />;
  if (team.isError) return <ErrorState error={team.error} onRetry={() => team.refetch()} />;
  const t = team.data;
  const isLeader = me.data?.membership?.employeeId === t.leader.id;
  const canManageBroadly = can('team.manage', 'department');
  const canManageMembers = canManageBroadly || (can('team.manage', 'team') && isLeader);
  const memberIds = new Set(t.members.map((m) => m.employeeId));
  const candidates = people.data?.filter((p) => !memberIds.has(p.id)) ?? [];

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link className="hover:underline" href="/teams">
            Teams
          </Link>
        }
        title={t.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={t.status} />
            <span>
              {t.department.name} · Led by {t.leader.fullName}
            </span>
          </span>
        }
        actions={
          <>
            {canManageMembers && t.status === 'active' ? (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil aria-hidden="true" /> Edit
              </Button>
            ) : null}
            {canManageBroadly ? (
              t.status === 'active' ? (
                <Button variant="outline" onClick={() => setArchiving(true)}>
                  <Archive aria-hidden="true" /> Archive
                </Button>
              ) : (
                <Button variant="outline" onClick={() => setStatus.mutate('restore')} loading={setStatus.isPending}>
                  <RotateCcw aria-hidden="true" /> Restore
                </Button>
              )
            ) : null}
          </>
        }
      />
      {t.description ? <p className="mb-4 max-w-2xl text-sm text-muted-foreground">{t.description}</p> : null}
      <Card>
        <CardHeader>
          <CardTitle>Members ({t.members.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {canManageMembers && t.status === 'active' ? (
            <form
              className="flex flex-col gap-2 sm:flex-row sm:items-end"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                if (adding) add.mutate();
              }}
            >
              <FormField label="Add a member" htmlFor="add-member" className="flex-1">
                <Select value={adding} onChange={(e) => setAdding(e.target.value)}>
                  <option value="">Choose a person</option>
                  {candidates.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName} · {p.jobTitle || p.employeeCode}
                    </option>
                  ))}
                </Select>
              </FormField>
              <Button type="submit" loading={add.isPending} disabled={!adding}>
                <UserPlus aria-hidden="true" /> Add
              </Button>
            </form>
          ) : null}
          {add.error ? <FormAlert error={add.error} /> : null}
          {t.members.length === 0 ? (
            <EmptyState title="No members" />
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {t.members.map((m) => (
                <li key={m.employeeId} className="flex items-center gap-3 px-3 py-2">
                  <Avatar name={m.fullName} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/employees/${m.employeeId}`} className="font-medium hover:underline">
                      {m.fullName}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {m.jobTitle || '—'} · since {formatDate(m.addedAt)}
                    </p>
                  </div>
                  {m.employeeId === t.leader.id ? <Badge>Leader</Badge> : null}
                  {canManageMembers && t.status === 'active' && m.employeeId !== t.leader.id ? (
                    <Button variant="ghost" size="sm" onClick={() => setRemoving(m)} aria-label={`Remove ${m.fullName}`}>
                      <UserMinus aria-hidden="true" />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {editing ? <EditTeamDialog team={t} onClose={() => setEditing(false)} leaderOnly={!canManageBroadly} /> : null}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.fullName} from ${t.name}?`}
        description="They stay in the organization; only their team membership ends."
        confirmLabel="Remove"
        destructive
        loading={remove.isPending}
        error={remove.error ? errorMessage(remove.error) : null}
        onConfirm={() => removing && remove.mutate(removing.employeeId)}
      />
      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title={`Archive ${t.name}?`}
        description="Archived teams no longer grant their leader visibility of members' work."
        confirmLabel="Archive"
        destructive
        loading={setStatus.isPending}
        error={setStatus.error ? errorMessage(setStatus.error) : null}
        onConfirm={() => setStatus.mutate('archive')}
      />
    </>
  );
}
