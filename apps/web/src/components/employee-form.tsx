'use client';

import type { FormEvent, ReactNode } from 'react';
import { EMPLOYMENT_TYPES } from '@omnitrack/contracts';
import { Button, FormField, Input, Select } from '@omnitrack/ui';
import { FormAlert, useFormState } from './common';
import { fieldErrors } from '@/lib/api';
import { EMPLOYMENT_TYPE_LABEL } from '@/lib/format';
import { useDepartments, useEmployeeOptions } from '@/lib/queries';

export interface EmployeeFormValues extends Record<string, string> {
  firstName: string;
  lastName: string;
  workEmail: string;
  phone: string;
  jobTitle: string;
  departmentId: string;
  managerId: string;
  employmentType: string;
  joinDate: string;
  location: string;
}

export const emptyEmployee: EmployeeFormValues = {
  firstName: '',
  lastName: '',
  workEmail: '',
  phone: '',
  jobTitle: '',
  departmentId: '',
  managerId: '',
  employmentType: 'full_time',
  joinDate: '',
  location: '',
};

/** Shared create/edit form. The server validates; field errors are mapped back here. */
export function EmployeeForm({
  initial,
  excludeManagerId,
  error,
  pending,
  submitLabel,
  onSubmit,
  extra,
}: {
  initial: EmployeeFormValues;
  excludeManagerId?: string;
  error: unknown;
  pending: boolean;
  submitLabel: string;
  onSubmit: (values: EmployeeFormValues) => void;
  extra?: ReactNode;
}) {
  const { values, bind } = useFormState(initial);
  const departments = useDepartments();
  const managers = useEmployeeOptions();
  const errs = fieldErrors(error);

  return (
    <form
      className="space-y-5"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit(values);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="First name" htmlFor="firstName" required error={errs.firstName}>
          <Input {...bind('firstName')} autoComplete="off" />
        </FormField>
        <FormField label="Last name" htmlFor="lastName" error={errs.lastName}>
          <Input {...bind('lastName')} autoComplete="off" />
        </FormField>
        <FormField label="Work email" htmlFor="workEmail" error={errs.workEmail}>
          <Input {...bind('workEmail')} type="email" autoComplete="off" />
        </FormField>
        <FormField label="Phone" htmlFor="phone" error={errs.phone}>
          <Input {...bind('phone')} type="tel" autoComplete="off" />
        </FormField>
        <FormField label="Job title" htmlFor="jobTitle" error={errs.jobTitle}>
          <Input {...bind('jobTitle')} />
        </FormField>
        <FormField label="Employment type" htmlFor="employmentType" error={errs.employmentType}>
          <Select {...bind('employmentType')}>
            {EMPLOYMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {EMPLOYMENT_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Department" htmlFor="departmentId" error={errs.departmentId}>
          <Select {...bind('departmentId')}>
            <option value="">No department</option>
            {departments.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.code})
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Manager" htmlFor="managerId" error={errs.managerId} hint="Only people you can see are listed.">
          <Select {...bind('managerId')}>
            <option value="">No manager</option>
            {managers.data
              ?.filter((m) => m.id !== excludeManagerId)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.fullName} · {m.employeeCode}
                </option>
              ))}
          </Select>
        </FormField>
        <FormField label="Join date" htmlFor="joinDate" error={errs.joinDate}>
          <Input {...bind('joinDate')} type="date" />
        </FormField>
        <FormField label="Location" htmlFor="location" error={errs.location}>
          <Input {...bind('location')} />
        </FormField>
      </div>
      {extra}
      {error && Object.keys(errs).length === 0 ? <FormAlert error={error} /> : null}
      <div className="flex justify-end">
        <Button type="submit" loading={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
