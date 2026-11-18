'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Mail, Pencil, UserCog } from 'lucide-react';
import {
  EMPLOYEE_TRANSITIONS,
  type EmployeeDto,
  type EmployeeStatus,
  type EmploymentEventDto,
} from '@omnitrack/contracts';
import {
  Avatar,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
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
import { ErrorState, FormAlert, LoadingPage, StatusBadge, nullable } from '@/components/common';
import { EmployeeForm, type EmployeeFormValues } from '@/components/employee-form';
import { InviteDialog } from '@/components/invite-dialog';
import { ApiError, fieldErrors, get, patch, post } from '@/lib/api';
import { EMPLOYMENT_TYPE_LABEL, STATUS_LABEL, formatDate, formatDateTime, todayIso } from '@/lib/format';
import { keys } from '@/lib/queries';
import { useCan } from '@/lib/session';

const EVENT_LABEL: Record<string, string> = {
  created: 'Record created',
  department_changed: 'Department changed',
  manager_changed: 'Manager changed',
  title_changed: 'Job title changed',
  employment_type_changed: 'Employment type changed',
  status_changed: 'Status changed',
};

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

function describeEvent(e: EmploymentEventDto): string {
  const to = e.to as Record<string, unknown> | string | null;
  if (e.type === 'status_changed' && to && typeof to === 'object') {
    return `${STATUS_LABEL[String(e.from)] ?? String(e.from)} → ${STATUS_LABEL[String(to.status)] ?? String(to.status)}${to.note ? ` · ${String(to.note)}` : ''}`;
  }
  if (e.type === 'title_changed') return `${String(e.from || '—')} → ${String(e.to || '—')}`;
  if (e.type === 'employment_type_changed') return `${EMPLOYMENT_TYPE_LABEL[String(e.from)] ?? e.from} → ${EMPLOYMENT_TYPE_LABEL[String(e.to)] ?? e.to}`;
  return '';
}

function StatusDialog({ employee, open, onOpenChange }: { employee: EmployeeDto; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const allowed = EMPLOYEE_TRANSITIONS[employee.status];
  const [status, setStatus] = useState<EmployeeStatus | ''>(allowed[0] ?? '');
  const [effectiveDate, setEffectiveDate] = useState(todayIso());
  const [note, setNote] = useState('');
  const change = useMutation({
    mutationFn: () =>
      post<EmployeeDto>(`/employees/${employee.id}/status`, { status, effectiveDate, note: note.trim() || undefined, version: employee.version }),
    onSuccess: async (e) => {
      qc.setQueryData(keys.employee(e.id), e);
      await qc.invalidateQueries({ queryKey: keys.employees });
      toast({ title: 'Status updated', description: `${e.fullName} is now ${STATUS_LABEL[e.status]?.toLowerCase()}.` });
      onOpenChange(false);
    },
  });
  const errs = fieldErrors(change.error);
  // HAS_ACTIVE_REPORTS lists who still reports to this person.
  const reports = change.error instanceof ApiError ? ((change.error.problem.reports as { id: string; fullName: string }[] | undefined) ?? []) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change employment status</DialogTitle>
          <DialogDescription>
            Currently {STATUS_LABEL[employee.status]?.toLowerCase()}. Exiting an employee ends their access to OmniTrack.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            change.mutate();
          }}
        >
          <FormField label="New status" htmlFor="new-status" required error={errs.status}>
            <Select value={status} onChange={(e) => setStatus(e.target.value as EmployeeStatus)}>
              {allowed.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Effective date" htmlFor="effective-date" required error={errs.effectiveDate}>
            <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
          </FormField>
          <FormField label="Note" htmlFor="status-note" error={errs.note}>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </FormField>
          {change.error && Object.keys(errs).length === 0 ? <FormAlert error={change.error} /> : null}
          {reports.length ? (
            <ul className="list-disc pl-5 text-sm">
              {reports.map((r) => (
                <li key={r.id}>
                  <Link className="text-primary hover:underline" href={`/employees/${r.id}`}>
                    {r.fullName}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant={status === 'exited' || status === 'cancelled' ? 'destructive' : 'default'} loading={change.isPending} disabled={!status}>
              Change status
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  const employee = useQuery({ queryKey: keys.employee(id), queryFn: () => get<EmployeeDto>(`/employees/${id}`) });
  const history = useQuery({ queryKey: [...keys.employee(id), 'history'], queryFn: () => get<EmploymentEventDto[]>(`/employees/${id}/history`) });
  const reports = useQuery({ queryKey: [...keys.employee(id), 'reports'], queryFn: () => get<EmployeeDto[]>(`/employees/${id}/direct-reports`) });

  const update = useMutation({
    mutationFn: (v: EmployeeFormValues) =>
      patch<EmployeeDto>(`/employees/${id}`, {
        firstName: v.firstName,
        lastName: v.lastName,
        workEmail: nullable(v.workEmail),
        phone: nullable(v.phone),
        jobTitle: v.jobTitle,
        departmentId: nullable(v.departmentId),
        managerId: nullable(v.managerId),
        employmentType: v.employmentType,
        joinDate: nullable(v.joinDate),
        location: v.location,
        version: employee.data!.version,
      }),
    onSuccess: async (e) => {
      qc.setQueryData(keys.employee(id), e);
      await qc.invalidateQueries({ queryKey: keys.employees });
      setEditing(false);
      toast({ title: 'Changes saved' });
    },
  });

  if (employee.isPending) return <LoadingPage />;
  if (employee.isError) return <ErrorState error={employee.error} onRetry={() => employee.refetch()} />;
  const e = employee.data;
  const closed = e.status === 'exited' || e.status === 'cancelled';

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/employees" className="hover:underline">
            Employees
          </Link>
        }
        title={e.fullName}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs">{e.employeeCode}</span>
            <StatusBadge status={e.status} />
            {e.jobTitle ? <span>· {e.jobTitle}</span> : null}
          </span>
        }
        actions={
          <>
            {!e.hasLogin && !closed && can('member.invite') ? (
              <Button variant="outline" onClick={() => setInviteOpen(true)}>
                <Mail aria-hidden="true" /> Invite to sign in
              </Button>
            ) : null}
            {can('employee.exit') && EMPLOYEE_TRANSITIONS[e.status].length > 0 ? (
              <Button variant="outline" onClick={() => setStatusOpen(true)}>
                <UserCog aria-hidden="true" /> Change status
              </Button>
            ) : null}
            {can('employee.update') && !closed && !editing ? (
              <Button onClick={() => setEditing(true)}>
                <Pencil aria-hidden="true" /> Edit
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{editing ? 'Edit profile' : 'Profile'}</CardTitle>
          </CardHeader>
          <CardContent>
            {editing ? (
              <>
                <EmployeeForm
                  initial={{
                    firstName: e.firstName,
                    lastName: e.lastName,
                    workEmail: e.workEmail ?? '',
                    phone: e.phone ?? '',
                    jobTitle: e.jobTitle,
                    departmentId: e.department?.id ?? '',
                    managerId: e.manager?.id ?? '',
                    employmentType: e.employmentType,
                    joinDate: e.joinDate ?? '',
                    location: e.location,
                  }}
                  excludeManagerId={e.id}
                  error={update.error}
                  pending={update.isPending}
                  submitLabel="Save changes"
                  onSubmit={(v) => update.mutate(v)}
                />
                <Button variant="ghost" className="mt-2" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <dl className="grid gap-4 sm:grid-cols-2">
                <Detail label="Work email">{e.workEmail ?? '—'}</Detail>
                <Detail label="Phone">{e.phone ?? '—'}</Detail>
                <Detail label="Department">{e.department?.name ?? '—'}</Detail>
                <Detail label="Manager">
                  {e.manager ? (
                    <Link className="text-primary hover:underline" href={`/employees/${e.manager.id}`}>
                      {e.manager.fullName}
                    </Link>
                  ) : (
                    '—'
                  )}
                </Detail>
                <Detail label="Teams">{e.teams.length ? e.teams.map((t) => t.name).join(', ') : '—'}</Detail>
                <Detail label="Employment type">{EMPLOYMENT_TYPE_LABEL[e.employmentType]}</Detail>
                <Detail label="Join date">{formatDate(e.joinDate)}</Detail>
                <Detail label="Exit date">{formatDate(e.exitDate)}</Detail>
                <Detail label="Location">{e.location || '—'}</Detail>
                <Detail label="Sign-in access">{e.hasLogin ? 'Has an OmniTrack login' : 'No login'}</Detail>
              </dl>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Direct reports</CardTitle>
          </CardHeader>
          <CardContent>
            {reports.isPending ? null : reports.isError ? (
              <ErrorState error={reports.error} onRetry={() => reports.refetch()} />
            ) : reports.data.length === 0 ? (
              <p className="text-sm text-muted-foreground">No direct reports.</p>
            ) : (
              <ul className="space-y-2">
                {reports.data.map((r) => (
                  <li key={r.id}>
                    <Link href={`/employees/${r.id}`} className="flex items-center gap-2 text-sm hover:underline">
                      <Avatar name={r.fullName} className="h-6 w-6 text-[10px]" />
                      {r.fullName}
                      <span className="text-muted-foreground">{r.jobTitle}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-4 w-4" aria-hidden="true" /> Employment history
            </CardTitle>
          </CardHeader>
          <CardContent>
            {history.isPending ? null : history.isError ? (
              <ErrorState error={history.error} onRetry={() => history.refetch()} />
            ) : history.data.length === 0 ? (
              <EmptyState title="No history yet" />
            ) : (
              <ol className="relative space-y-4 border-l border-border pl-5">
                {history.data.map((h) => (
                  <li key={h.id}>
                    <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-primary" aria-hidden="true" />
                    <p className="text-sm font-medium">{EVENT_LABEL[h.type] ?? h.type}</p>
                    {describeEvent(h) ? <p className="text-sm text-muted-foreground">{describeEvent(h)}</p> : null}
                    <p className="text-xs text-muted-foreground">
                      Effective {formatDate(h.effectiveDate)} · recorded {formatDateTime(h.createdAt)}
                      {h.actor ? ` by ${h.actor}` : ''}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      {statusOpen ? <StatusDialog employee={e} open={statusOpen} onOpenChange={setStatusOpen} /> : null}
      {inviteOpen ? <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} employee={{ id: e.id, email: e.workEmail ?? '' }} /> : null}
    </>
  );
}
