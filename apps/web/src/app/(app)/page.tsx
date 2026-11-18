'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Building2, ClipboardList, KeyRound, ShieldCheck, Users, UsersRound } from 'lucide-react';
import type { EmployeeDto, Page } from '@omnitrack/contracts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader, Skeleton } from '@omnitrack/ui';
import type { ReactNode } from 'react';
import { get } from '@/lib/api';
import { useDepartments, useMembers, useTeams } from '@/lib/queries';
import { useCan, useMe } from '@/lib/session';

function Stat({ label, value, loading, href, icon, note }: { label: string; value: number | undefined; loading: boolean; href: string; icon: ReactNode; note?: string }) {
  return (
    <Link href={href} className="group rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card className="h-full transition-colors group-hover:border-primary/40">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <CardDescription className="font-medium text-foreground">{label}</CardDescription>
          <span className="text-muted-foreground [&_svg]:h-4 [&_svg]:w-4" aria-hidden="true">
            {icon}
          </span>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-8 w-16" /> : <p className="text-3xl font-semibold tabular-nums">{value ?? '—'}</p>}
          {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
        </CardContent>
      </Card>
    </Link>
  );
}

export default function HomePage() {
  const me = useMe();
  const can = useCan();
  const canEmployees = can('employee.read');
  const employees = useQuery({
    queryKey: ['employees', 'count', 'active'],
    queryFn: () => get<Page<EmployeeDto>>('/employees', { status: 'active', limit: 1 }),
    enabled: canEmployees,
  });
  const departments = useDepartments(false, can('department.read'));
  const teams = useTeams(false, can('team.read'));
  const members = useMembers(can('member.read'));
  const scope = me.data?.permissions['employee.read'];

  const links = [
    { href: '/employees', label: 'Browse employees', icon: <Users />, show: canEmployees },
    { href: '/employees/new', label: 'Add an employee', icon: <Users />, show: can('employee.create') },
    { href: '/members', label: 'Invite people', icon: <UsersRound />, show: can('member.invite') },
    { href: '/roles', label: 'Review roles and permissions', icon: <KeyRound />, show: can('role.read') },
    { href: '/audit', label: 'Check the audit log', icon: <ClipboardList />, show: can('audit.read') },
    { href: '/settings/security', label: 'Your security settings', icon: <ShieldCheck />, show: true },
  ].filter((l) => l.show);

  return (
    <>
      <PageHeader
        title={`Welcome, ${me.data?.user.displayName.split(' ')[0] ?? ''}`}
        description={`${me.data?.organization?.name ?? ''} · ${me.data?.membership?.roles.map((r) => r.name).join(', ') ?? ''}`}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {canEmployees ? (
          <Stat
            label="Active employees"
            value={employees.data?.total}
            loading={employees.isPending}
            href="/employees?status=active"
            icon={<Users />}
            note={scope && scope !== 'organization' ? `Within your ${scope} scope` : undefined}
          />
        ) : null}
        {can('department.read') ? (
          <Stat label="Departments" value={departments.data?.length} loading={departments.isPending} href="/departments" icon={<Building2 />} />
        ) : null}
        {can('team.read') ? <Stat label="Teams" value={teams.data?.length} loading={teams.isPending} href="/teams" icon={<UsersRound />} /> : null}
        {can('member.read') ? (
          <Stat
            label="Members with access"
            value={members.data?.filter((m) => m.status === 'active').length}
            loading={members.isPending}
            href="/members"
            icon={<ShieldCheck />}
          />
        ) : null}
      </div>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Quick actions</CardTitle>
          <CardDescription>Shortcuts to what you can do with your current role.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {links.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="flex items-center gap-3 rounded-md border border-border px-3 py-2.5 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:h-4 [&_svg]:w-4"
                >
                  <span className="text-muted-foreground" aria-hidden="true">
                    {l.icon}
                  </span>
                  {l.label}
                  <ArrowRight className="ml-auto text-muted-foreground" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
