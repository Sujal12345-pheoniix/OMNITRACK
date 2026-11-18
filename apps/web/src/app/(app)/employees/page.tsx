'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Plus, Search, Users } from 'lucide-react';
import { EMPLOYEE_STATUSES, type EmployeeDto, type Page } from '@omnitrack/contracts';
import { Avatar, Button, Card, EmptyState, Input, Label, PageHeader, Select, TBody, TD, TH, THead, TR, Table } from '@omnitrack/ui';
import { ErrorState, LoadingRows, StatusBadge } from '@/components/common';
import { get } from '@/lib/api';
import { STATUS_LABEL, formatDate } from '@/lib/format';
import { useDepartments, useTeams } from '@/lib/queries';
import { useCan } from '@/lib/session';

const PAGE = 25;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function EmployeesList() {
  const can = useCan();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const debouncedQ = useDebounced(q, 300);
  const filters = {
    status: params.get('status') ?? '',
    departmentId: params.get('departmentId') ?? '',
    teamId: params.get('teamId') ?? '',
    sort: params.get('sort') ?? 'name',
    order: params.get('order') ?? 'asc',
  };

  const setParam = (name: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(name, value);
    else next.delete(name);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  useEffect(() => {
    if ((params.get('q') ?? '') !== debouncedQ) setParam('q', debouncedQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync search box to URL only when the debounced value changes
  }, [debouncedQ]);

  const departments = useDepartments(false, can('department.read'));
  const teams = useTeams(false, can('team.read'));
  const query = { q: params.get('q') ?? '', ...filters };

  const list = useInfiniteQuery({
    queryKey: ['employees', 'list', query],
    queryFn: ({ pageParam }) => get<Page<EmployeeDto>>('/employees', { ...query, limit: PAGE, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages[0]?.total;
  const filtered = Boolean(query.q || filters.status || filters.departmentId || filters.teamId);

  return (
    <>
      <PageHeader
        title="Employees"
        description={total !== undefined ? `${total} ${total === 1 ? 'person' : 'people'}${filtered ? ' match your filters' : ''}` : 'Your organization directory'}
        actions={
          can('employee.create') ? (
            <Button asChild>
              <Link href="/employees/new">
                <Plus aria-hidden="true" /> Add employee
              </Link>
            </Button>
          ) : null
        }
      />
      <Card className="mb-4 p-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr]">
          <div className="relative">
            <Label htmlFor="emp-search" className="sr-only">
              Search employees
            </Label>
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input id="emp-search" type="search" placeholder="Search name, code, email, title" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
          </div>
          <div>
            <Label htmlFor="f-status" className="sr-only">
              Status
            </Label>
            <Select id="f-status" value={filters.status} onChange={(e) => setParam('status', e.target.value)}>
              <option value="">All statuses</option>
              {EMPLOYEE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="f-dept" className="sr-only">
              Department
            </Label>
            <Select id="f-dept" value={filters.departmentId} onChange={(e) => setParam('departmentId', e.target.value)}>
              <option value="">All departments</option>
              {departments.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="f-team" className="sr-only">
              Team
            </Label>
            <Select id="f-team" value={filters.teamId} onChange={(e) => setParam('teamId', e.target.value)}>
              <option value="">All teams</option>
              {teams.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="f-sort" className="sr-only">
              Sort
            </Label>
            <Select
              id="f-sort"
              value={`${filters.sort}:${filters.order}`}
              onChange={(e) => {
                const [sort, order] = e.target.value.split(':');
                const next = new URLSearchParams(params.toString());
                next.set('sort', sort!);
                next.set('order', order!);
                router.replace(`${pathname}?${next.toString()}`, { scroll: false });
              }}
            >
              <option value="name:asc">Name A–Z</option>
              <option value="name:desc">Name Z–A</option>
              <option value="code:asc">Employee code</option>
              <option value="joinDate:desc">Newest joiners</option>
              <option value="createdAt:desc">Recently added</option>
            </Select>
          </div>
        </div>
      </Card>

      {list.isPending ? (
        <LoadingRows />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title={filtered ? 'No employees match these filters' : 'No employees yet'}
          description={filtered ? 'Try a different search or clear the filters.' : 'Add your first employee to start building your directory.'}
          action={
            filtered ? (
              <Button variant="outline" onClick={() => { setQ(''); router.replace(pathname); }}>
                Clear filters
              </Button>
            ) : can('employee.create') ? (
              <Button asChild>
                <Link href="/employees/new">Add employee</Link>
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          {/* Desktop table */}
          <Card className="hidden overflow-hidden md:block">
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Code</TH>
                  <TH>Title</TH>
                  <TH>Department</TH>
                  <TH>Manager</TH>
                  <TH>Joined</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((e) => (
                  <TR key={e.id}>
                    <TD>
                      <Link href={`/employees/${e.id}`} className="flex items-center gap-2 font-medium hover:underline">
                        <Avatar name={e.fullName} className="h-7 w-7" />
                        <span>
                          {e.fullName}
                          {e.workEmail ? <span className="block text-xs font-normal text-muted-foreground">{e.workEmail}</span> : null}
                        </span>
                      </Link>
                    </TD>
                    <TD className="font-mono text-xs">{e.employeeCode}</TD>
                    <TD>{e.jobTitle || '—'}</TD>
                    <TD>{e.department?.name ?? '—'}</TD>
                    <TD>{e.manager?.fullName ?? '—'}</TD>
                    <TD className="whitespace-nowrap">{formatDate(e.joinDate)}</TD>
                    <TD>
                      <StatusBadge status={e.status} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
          {/* Mobile cards */}
          <ul className="space-y-2 md:hidden">
            {rows.map((e) => (
              <li key={e.id}>
                <Link href={`/employees/${e.id}`} className="block rounded-lg border border-border bg-surface p-3">
                  <div className="flex items-center gap-3">
                    <Avatar name={e.fullName} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{e.fullName}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[e.jobTitle, e.department?.name].filter(Boolean).join(' · ') || e.employeeCode}
                      </p>
                    </div>
                    <StatusBadge status={e.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Showing {rows.length} of {total}
            </span>
            {list.hasNextPage ? (
              <Button variant="outline" onClick={() => list.fetchNextPage()} loading={list.isFetchingNextPage}>
                Load more
              </Button>
            ) : null}
          </div>
        </>
      )}
    </>
  );
}

export default function EmployeesPage() {
  return (
    <Suspense>
      <EmployeesList />
    </Suspense>
  );
}
