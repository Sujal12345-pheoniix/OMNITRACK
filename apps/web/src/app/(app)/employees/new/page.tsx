'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { EmployeeDto } from '@omnitrack/contracts';
import { Card, CardContent, CardHeader, CardTitle, Checkbox, Label, PageHeader, toast } from '@omnitrack/ui';
import { nullable } from '@/components/common';
import { EmployeeForm, emptyEmployee, type EmployeeFormValues } from '@/components/employee-form';
import { post } from '@/lib/api';
import { keys, useTeams } from '@/lib/queries';
import { useCan } from '@/lib/session';
import { ErrorState } from '@/components/common';
import { ApiError } from '@/lib/api';

export default function NewEmployeePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const can = useCan();
  const teams = useTeams();
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [preJoining, setPreJoining] = useState(false);

  const create = useMutation({
    mutationFn: (v: EmployeeFormValues) =>
      post<EmployeeDto>('/employees', {
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
        status: preJoining ? 'pre_joining' : 'active',
        teamIds,
      }),
    onSuccess: async (e) => {
      await qc.invalidateQueries({ queryKey: keys.employees });
      toast({ title: 'Employee added', description: `${e.fullName} · ${e.employeeCode}` });
      router.push(`/employees/${e.id}`);
    },
  });

  if (!can('employee.create')) return <ErrorState error={new ApiError(403, { code: 'FORBIDDEN' })} />;

  return (
    <>
      <PageHeader
        title="Add employee"
        breadcrumb={
          <Link href="/employees" className="hover:underline">
            Employees
          </Link>
        }
        description="The employee code is generated automatically."
      />
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Employee details</CardTitle>
        </CardHeader>
        <CardContent>
          <EmployeeForm
            initial={emptyEmployee}
            error={create.error}
            pending={create.isPending}
            submitLabel="Add employee"
            onSubmit={(v) => create.mutate(v)}
            extra={
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Checkbox id="prejoin" checked={preJoining} onCheckedChange={(c) => setPreJoining(c === true)} />
                  <Label htmlFor="prejoin">Not joined yet (pre-joining)</Label>
                </div>
                {teams.data && teams.data.length > 0 ? (
                  <fieldset>
                    <legend className="mb-2 text-sm font-medium">Teams</legend>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {teams.data.map((t) => (
                        <div key={t.id} className="flex items-center gap-2">
                          <Checkbox
                            id={`team-${t.id}`}
                            checked={teamIds.includes(t.id)}
                            onCheckedChange={(c) => setTeamIds((ids) => (c === true ? [...ids, t.id] : ids.filter((i) => i !== t.id)))}
                          />
                          <Label htmlFor={`team-${t.id}`} className="font-normal">
                            {t.name} <span className="text-muted-foreground">· {t.department.name}</span>
                          </Label>
                        </div>
                      ))}
                    </div>
                  </fieldset>
                ) : null}
              </div>
            }
          />
        </CardContent>
      </Card>
    </>
  );
}
