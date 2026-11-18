'use client';

import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, Building2, ChevronRight, Pencil, Plus, RotateCcw } from 'lucide-react';
import type { DepartmentDto } from '@omnitrack/contracts';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FormField,
  Input,
  Label,
  PageHeader,
  Select,
  Textarea,
  toast,
} from '@omnitrack/ui';
import { ErrorState, FormAlert, LoadingRows, nullable, useFormState } from '@/components/common';
import { errorMessage, fieldErrors, patch, post } from '@/lib/api';
import { keys, useDepartments, useEmployeeOptions } from '@/lib/queries';
import { useCan } from '@/lib/session';

interface Node extends DepartmentDto {
  children: Node[];
}

function buildTree(list: DepartmentDto[]): Node[] {
  const map = new Map<string, Node>(list.map((d) => [d.id, { ...d, children: [] }]));
  const roots: Node[] = [];
  for (const n of map.values()) {
    const parent = n.parentId ? map.get(n.parentId) : undefined;
    if (parent) parent.children.push(n);
    else roots.push(n);
  }
  const sort = (ns: Node[]) => {
    ns.sort((a, b) => a.name.localeCompare(b.name));
    ns.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

function DepartmentDialog({
  open,
  onOpenChange,
  department,
  departments,
  defaultParentId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  department?: DepartmentDto;
  departments: DepartmentDto[];
  defaultParentId?: string;
}) {
  const qc = useQueryClient();
  const people = useEmployeeOptions(open);
  const { values, bind } = useFormState({
    name: department?.name ?? '',
    code: department?.code ?? '',
    description: department?.description ?? '',
    parentId: department?.parentId ?? defaultParentId ?? '',
    headEmployeeId: department?.head?.id ?? '',
  });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: values.name,
        code: values.code,
        description: values.description,
        parentId: nullable(values.parentId),
        headEmployeeId: nullable(values.headEmployeeId),
      };
      return department ? patch(`/departments/${department.id}`, { ...body, version: department.version }) : post('/departments', body);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: keys.departments });
      toast({ title: department ? 'Department updated' : 'Department created', description: values.name });
      onOpenChange(false);
    },
  });
  const errs = fieldErrors(save.error);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{department ? 'Edit department' : 'New department'}</DialogTitle>
          <DialogDescription>Departments can be nested up to six levels deep.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <FormField label="Name" htmlFor="dept-name" required error={errs.name}>
              <Input {...bind('name')} />
            </FormField>
            <FormField label="Code" htmlFor="dept-code" required error={errs.code} hint="e.g. SALES">
              <Input {...bind('code')} className="uppercase" />
            </FormField>
          </div>
          <FormField label="Parent department" htmlFor="dept-parent" error={errs.parentId}>
            <Select {...bind('parentId')}>
              <option value="">None (top level)</option>
              {departments
                .filter((d) => d.id !== department?.id)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </Select>
          </FormField>
          <FormField label="Head of department" htmlFor="dept-head" error={errs.headEmployeeId}>
            <Select {...bind('headEmployeeId')}>
              <option value="">No head</option>
              {people.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Description" htmlFor="dept-desc" error={errs.description}>
            <Textarea {...bind('description')} maxLength={500} />
          </FormField>
          {save.error && Object.keys(errs).length === 0 ? <FormAlert error={save.error} /> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              {department ? 'Save changes' : 'Create department'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TreeRow({
  node,
  depth,
  canManage,
  onEdit,
  onAddChild,
  onArchive,
  onRestore,
}: {
  node: Node;
  depth: number;
  canManage: boolean;
  onEdit: (d: DepartmentDto) => void;
  onAddChild: (d: DepartmentDto) => void;
  onArchive: (d: DepartmentDto) => void;
  onRestore: (d: DepartmentDto) => void;
}) {
  const archived = node.status === 'archived';
  return (
    <li role="treeitem" aria-expanded={node.children.length ? true : undefined} aria-selected={false}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5 hover:bg-muted/40" style={{ paddingLeft: `${0.75 + depth * 1.25}rem` }}>
        {depth > 0 ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> : null}
        <span className={archived ? 'text-muted-foreground line-through' : 'font-medium'}>{node.name}</span>
        <Badge variant="outline" className="font-mono">
          {node.code}
        </Badge>
        {archived ? <Badge variant="secondary">Archived</Badge> : null}
        <span className="text-xs text-muted-foreground">
          {node.employeeCount} {node.employeeCount === 1 ? 'person' : 'people'} · {node.teamCount} {node.teamCount === 1 ? 'team' : 'teams'}
          {node.head ? ` · Head: ${node.head.fullName}` : ''}
        </span>
        {canManage ? (
          <div className="ml-auto flex gap-1">
            {archived ? (
              <Button variant="ghost" size="sm" onClick={() => onRestore(node)}>
                <RotateCcw aria-hidden="true" /> Restore
              </Button>
            ) : (
              <>
                <Button variant="ghost" size="sm" onClick={() => onAddChild(node)} aria-label={`Add sub-department to ${node.name}`}>
                  <Plus aria-hidden="true" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onEdit(node)} aria-label={`Edit ${node.name}`}>
                  <Pencil aria-hidden="true" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onArchive(node)} aria-label={`Archive ${node.name}`}>
                  <Archive aria-hidden="true" />
                </Button>
              </>
            )}
          </div>
        ) : null}
      </div>
      {node.children.length ? (
        <ul role="group">
          {node.children.map((c) => (
            <TreeRow key={c.id} node={c} depth={depth + 1} canManage={canManage} onEdit={onEdit} onAddChild={onAddChild} onArchive={onArchive} onRestore={onRestore} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export default function DepartmentsPage() {
  const can = useCan();
  const qc = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const list = useDepartments(showArchived);
  const [dialog, setDialog] = useState<{ department?: DepartmentDto; parentId?: string } | null>(null);
  const [confirm, setConfirm] = useState<{ department: DepartmentDto; action: 'archive' | 'restore' } | null>(null);
  const canManage = can('department.manage');

  const statusChange = useMutation({
    mutationFn: (c: { department: DepartmentDto; action: 'archive' | 'restore' }) => post(`/departments/${c.department.id}/${c.action}`),
    onSuccess: async (_d, c) => {
      await qc.invalidateQueries({ queryKey: keys.departments });
      toast({ title: c.action === 'archive' ? 'Department archived' : 'Department restored', description: c.department.name });
      setConfirm(null);
    },
  });

  const tree = list.data ? buildTree(list.data) : [];

  return (
    <>
      <PageHeader
        title="Departments"
        description="Your organization's structure. Department heads see and manage everything beneath their department."
        actions={
          canManage ? (
            <Button onClick={() => setDialog({})}>
              <Plus aria-hidden="true" /> New department
            </Button>
          ) : null
        }
      />
      <div className="mb-3 flex items-center gap-2">
        <Checkbox id="show-archived" checked={showArchived} onCheckedChange={(c) => setShowArchived(c === true)} />
        <Label htmlFor="show-archived" className="font-normal">
          Show archived
        </Label>
      </div>
      {list.isPending ? (
        <LoadingRows />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : tree.length === 0 ? (
        <EmptyState
          icon={<Building2 />}
          title="No departments yet"
          description="Create departments to organize people, teams and reporting."
          action={canManage ? <Button onClick={() => setDialog({})}>New department</Button> : null}
        />
      ) : (
        <Card className="overflow-hidden">
          <ul role="tree" aria-label="Departments">
            {tree.map((n) => (
              <TreeRow
                key={n.id}
                node={n}
                depth={0}
                canManage={canManage}
                onEdit={(d) => setDialog({ department: d })}
                onAddChild={(d) => setDialog({ parentId: d.id })}
                onArchive={(d) => setConfirm({ department: d, action: 'archive' })}
                onRestore={(d) => setConfirm({ department: d, action: 'restore' })}
              />
            ))}
          </ul>
        </Card>
      )}
      {dialog ? (
        <DepartmentDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          department={dialog.department}
          defaultParentId={dialog.parentId}
          departments={(list.data ?? []).filter((d) => d.status === 'active')}
        />
      ) : null}
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => {
          if (!o) {
            setConfirm(null);
            statusChange.reset();
          }
        }}
        title={confirm?.action === 'archive' ? `Archive ${confirm.department.name}?` : `Restore ${confirm?.department.name}?`}
        description={
          confirm?.action === 'archive'
            ? 'Archived departments cannot be assigned to people. A department must have no active employees, sub-departments or teams.'
            : 'The department becomes available again.'
        }
        confirmLabel={confirm?.action === 'archive' ? 'Archive' : 'Restore'}
        destructive={confirm?.action === 'archive'}
        loading={statusChange.isPending}
        error={statusChange.error ? errorMessage(statusChange.error) : null}
        onConfirm={() => confirm && statusChange.mutate(confirm)}
      />
    </>
  );
}
