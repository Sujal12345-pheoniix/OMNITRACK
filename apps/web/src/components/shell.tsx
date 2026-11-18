'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Bell,
  Building2,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  ClipboardList,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Settings,
  ShieldCheck,
  Users,
  UsersRound,
  X,
} from 'lucide-react';
import type { MeResponse } from '@omnitrack/contracts';
import { hasPermission, type PermissionCode, type Scope } from '@omnitrack/permissions';
import {
  Avatar,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  FormField,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
} from '@omnitrack/ui';
import { FormAlert, useFormState } from './common';
import { fieldErrors, post } from '@/lib/api';

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  permission?: PermissionCode;
}

const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'Overview', items: [{ href: '/', label: 'Home', icon: <LayoutDashboard /> }] },
  {
    group: 'People',
    items: [
      { href: '/employees', label: 'Employees', icon: <Users />, permission: 'employee.read' },
      { href: '/departments', label: 'Departments', icon: <Building2 />, permission: 'department.read' },
      { href: '/teams', label: 'Teams', icon: <UsersRound />, permission: 'team.read' },
    ],
  },
  {
    group: 'Administration',
    items: [
      { href: '/members', label: 'Members & invitations', icon: <UsersRound />, permission: 'member.read' },
      { href: '/roles', label: 'Roles', icon: <KeyRound />, permission: 'role.read' },
      { href: '/audit', label: 'Audit log', icon: <ClipboardList />, permission: 'audit.read' },
      { href: '/settings/organization', label: 'Organization settings', icon: <Settings />, permission: 'organization.read' },
    ],
  },
];

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

function Sidebar({ me, collapsed, onNavigate }: { me: MeResponse; collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const grants = me.permissions as Partial<Record<PermissionCode, Scope>>;
  return (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 py-3">
      {NAV.map((section) => {
        const items = section.items.filter((i) => !i.permission || hasPermission(grants, i.permission));
        if (items.length === 0) return null;
        return (
          <div key={section.group} className="mb-4">
            {!collapsed ? (
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">{section.group}</p>
            ) : null}
            <ul className="space-y-0.5">
              {items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        'flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/90 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0',
                        active && 'bg-sidebar-accent font-medium text-sidebar-foreground',
                        collapsed && 'justify-center px-2',
                      )}
                    >
                      {item.icon}
                      <span className={cn(collapsed && 'sr-only')}>{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <Link href="/" className="flex h-14 items-center gap-2 px-4 font-semibold tracking-tight text-sidebar-foreground">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground" aria-hidden="true">
        O
      </span>
      <span className={cn(collapsed && 'sr-only')}>OmniTrack</span>
    </Link>
  );
}

export function CreateOrganizationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { values, setValues, bind } = useFormState({ name: '', slug: '' });
  const create = useMutation({
    mutationFn: async () => {
      const org = await post<{ id: string }>('/organizations', values);
      await post('/auth/switch-organization', { organizationId: org.id });
    },
    onSuccess: () => window.location.assign('/'),
  });
  const errs = fieldErrors(create.error);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create an organization</DialogTitle>
          <DialogDescription>You will become its owner. Its data is completely separate from your other organizations.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <FormField label="Name" htmlFor="org-name" required error={errs.name}>
            <Input
              {...bind('name')}
              onChange={(e) =>
                setValues({
                  name: e.target.value,
                  slug: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40),
                })
              }
            />
          </FormField>
          <FormField label="Address" htmlFor="org-slug" required error={errs.slug} hint="Lowercase letters, digits and hyphens.">
            <Input {...bind('slug')} />
          </FormField>
          {create.error && Object.keys(errs).length === 0 ? <FormAlert error={create.error} /> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending}>
              Create and switch
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function OrgSwitcher({ me }: { me: MeResponse }) {
  const [creating, setCreating] = useState(false);
  const switchOrg = useMutation({
    mutationFn: (organizationId: string) => post('/auth/switch-organization', { organizationId }),
    // Reload so no data from the previous organization survives in any cache.
    onSuccess: () => window.location.assign('/'),
  });
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="max-w-[16rem] justify-between gap-2" aria-label="Switch organization">
            <Building2 aria-hidden="true" />
            <span className="truncate">{me.organization?.name ?? 'No organization'}</span>
            <ChevronsUpDown className="opacity-60" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Organizations</DropdownMenuLabel>
          {me.organizations.map((o) => (
            <DropdownMenuItem key={o.id} disabled={o.current || switchOrg.isPending} onSelect={() => switchOrg.mutate(o.id)}>
              <span className="truncate">{o.name}</span>
              {o.current ? <span className="ml-auto text-xs text-muted-foreground">Current</span> : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreating(true)}>
            <Plus aria-hidden="true" /> Create organization
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateOrganizationDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

function Notifications() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Notifications">
          <Bell aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent>
        <p className="mb-3 text-sm font-semibold">Notifications</p>
        <EmptyState title="No notifications yet" description="Assignments, reminders and approvals will appear here." className="py-6" />
      </PopoverContent>
    </Popover>
  );
}

function ProfileMenu({ me }: { me: MeResponse }) {
  const logout = useMutation({
    mutationFn: () => post('/auth/logout'),
    onSettled: () => window.location.assign('/login'),
  });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Account menu">
          <Avatar name={me.user.displayName} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <p className="truncate text-sm font-semibold text-foreground">{me.user.displayName}</p>
          <p className="truncate text-xs">{me.user.email}</p>
          {me.membership ? <p className="mt-1 truncate text-xs">{me.membership.roles.map((r) => r.name).join(', ')}</p> : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings/security">
            <ShieldCheck aria-hidden="true" /> Security settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => logout.mutate()}>
          <LogOut aria-hidden="true" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Shell({ me, children }: { me: MeResponse; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem('ot.sidebar') === 'collapsed');
    } catch {
      /* storage unavailable: keep default */
    }
  }, []);
  useEffect(() => setMobileOpen(false), [pathname]);

  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem('ot.sidebar', c ? 'expanded' : 'collapsed');
      } catch {
        /* ignore */
      }
      return !c;
    });
  };

  return (
    <div className="flex min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      {/* Desktop sidebar */}
      <aside className={cn('sticky top-0 hidden h-screen flex-col bg-sidebar transition-[width] md:flex', collapsed ? 'w-16' : 'w-60')}>
        <Brand collapsed={collapsed} />
        <Sidebar me={me} collapsed={collapsed} />
        <button
          onClick={toggle}
          className="m-2 flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" aria-hidden="true" /> : <ChevronsLeft className="h-4 w-4" aria-hidden="true" />}
          {!collapsed ? 'Collapse' : null}
        </button>
      </aside>
      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-sidebar">
            <div className="flex items-center justify-between pr-2">
              <Brand collapsed={false} />
              <button onClick={() => setMobileOpen(false)} className="rounded p-2 text-sidebar-foreground" aria-label="Close navigation">
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <Sidebar me={me} collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-surface/95 px-3 backdrop-blur sm:px-5">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu aria-hidden="true" />
          </Button>
          <OrgSwitcher me={me} />
          <div className="ml-auto flex items-center gap-1">
            <Notifications />
            <ProfileMenu me={me} />
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 sm:px-6 sm:py-6">
          {children}
        </main>
      </div>
    </div>
  );
}
