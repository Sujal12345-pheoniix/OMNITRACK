import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  addTeamMemberRequest,
  changeEmployeeStatusRequest,
  createEmployeeRequest,
  departmentRequest,
  employeeListQuery,
  teamRequest,
  updateDepartmentRequest,
  updateEmployeeRequest,
  updateTeamRequest,
} from '@omnitrack/contracts';
import { z } from 'zod';
import type { TenantRequestContext } from '../common/context';
import { RequirePermission, TenantCtx } from '../common/decorators';
import { UuidParam, ZodPipe } from '../common/zod.pipe';
import { EmployeesService } from './employees.service';
import { StructureService } from './structure.service';

const archivedQuery = z.object({ includeArchived: z.enum(['true', 'false']).optional() }).passthrough();
const teamListQuery = z.object({ departmentId: z.string().uuid().optional(), includeArchived: z.enum(['true', 'false']).optional() });

@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  @RequirePermission('employee.read')
  list(@TenantCtx() ctx: TenantRequestContext, @Query(new ZodPipe(employeeListQuery)) q: z.infer<typeof employeeListQuery>) {
    return this.employees.list(ctx, q);
  }

  @Post()
  @RequirePermission('employee.create')
  create(@TenantCtx() ctx: TenantRequestContext, @Body(new ZodPipe(createEmployeeRequest)) body: z.infer<typeof createEmployeeRequest>) {
    return this.employees.create(ctx, body);
  }

  @Get(':id')
  @RequirePermission('employee.read')
  get(@TenantCtx() ctx: TenantRequestContext, @Param('id', UuidParam) id: string) {
    return this.employees.get(ctx, id);
  }

  @Patch(':id')
  @RequirePermission('employee.update')
  update(
    @TenantCtx() ctx: TenantRequestContext,
    @Param('id', UuidParam) id: string,
    @Body(new ZodPipe(updateEmployeeRequest)) body: z.infer<typeof updateEmployeeRequest>,
  ) {
    return this.employees.update(ctx, id, body);
  }

  @Post(':id/status')
  @RequirePermission('employee.exit')
  @HttpCode(200)
  status(
    @TenantCtx() ctx: TenantRequestContext,
    @Param('id', UuidParam) id: string,
    @Body(new ZodPipe(changeEmployeeStatusRequest)) body: z.infer<typeof changeEmployeeStatusRequest>,
  ) {
    return this.employees.changeStatus(ctx, id, body);
  }

  @Get(':id/history')
  @RequirePermission('employee.read')
  history(@TenantCtx() ctx: TenantRequestContext, @Param('id', UuidParam) id: string) {
    return this.employees.history(ctx, id);
  }

  @Get(':id/direct-reports')
  @RequirePermission('employee.read')
  directReports(@TenantCtx() ctx: TenantRequestContext, @Param('id', UuidParam) id: string) {
    return this.employees.directReports(ctx, id);
  }
}

@Controller('departments')
export class DepartmentsController {
  constructor(private readonly structure: StructureService) {}

  @Get()
  @RequirePermission('department.read')
  list(@TenantCtx() ctx: TenantRequestContext, @Query(new ZodPipe(archivedQuery)) q: z.infer<typeof archivedQuery>) {
    return this.structure.listDepartments(ctx, q.includeArchived === 'true');
  }

  @Get('tree')
  @RequirePermission('department.read')
  tree(@TenantCtx() ctx: TenantRequestContext) {
    return this.structure.departmentTree(ctx);
  }

  @Get(':id')
  @RequirePermission('department.read')
  get(@TenantCtx() ctx: TenantRequestContext, @Param('id', UuidParam) id: string) {
    return this.structure.getDepartment(ctx, id);
  }

  @Post()
  @RequirePermission('department.manage')
  create(@TenantCtx() ctx: TenantRequestContext, @Body(new ZodPipe(departmentRequest)) body: z.infer<typeof departmentRequest>) {
    return this.structure.createDepartment(ctx, body);
  }

  @Patch(':id')
  @RequirePermission('department.manage')
  update(
    @TenantCtx() ctx: TenantRequestContext,
    @Param('id', UuidParam) id: string,
    @Body(new ZodPipe(updateDepartmentRequest)) body: z.infer<typeof updateDepartmentRequest>,
  ) {
    return this.structure.updateDepartment(ctx, id, body);
  }

  @Post(':id/archive')
  @RequirePermission('department.manage')
  @HttpCode(200)
  archive(@TenantCtx() ctx: TenantRequestContext, @Param('id', UuidParam) id: string) {
    return this.structure.setDepartmentStatus(ctx, id, 'archived');
  }

  @Post(':id/restore')
  @RequirePermission('department.manage')
  @HttpCode(200)
  restore(@TenantCtx() ctx: TenantRequestContext, @Param('id', UuidParam) id: string) {
    return this.structure.setDepartmentStatus(ctx, id, 'active');
  }
}

@Controller('teams')
export class TeamsController {
  constructor(private readonly structure: StructureService) {}

  @Get()
  @RequirePermission('team.read')
  list(@TenantCtx() ctx: TenantRequestContext, @Query(new ZodPipe(teamListQuery)) q: z.infer<typeof teamListQuery>) {
    return this.structure.listTeams(ctx, { departmentId: q.departmentId, includeArchived: q.includeArchived === 'true' });
  }

  @Get(':id')
  @RequirePermission('team.read')
  get(@TenantCtx() ctx: TenantRequestContext, @Param('id', UuidParam) id: string) {
    return this.structure.getTeam(ctx, id);
  }

  @Post()
  @RequirePermission('team.manage')
  create(@TenantCtx() ctx: TenantRequestContext, @Body(new ZodPipe(teamRequest)) body: z.infer<typeof teamRequest>) {
    return this.structure.createTeam(ctx, body);
  }

  @Patch(':id')
  @RequirePermission('team.manage')
  update(
    @TenantCtx() ctx: TenantRequestContext,
    @Param('id', UuidParam) id: string,
    @Body(new ZodPipe(updateTeamRequest)) body: z.infer<typeof updateTeamRequest>,
  ) {
    return this.structure.updateTeam(ctx, id, body);
  }

  @Post(':id/archive')
  @RequirePermission('team.manage')
  @HttpCode(200)
  archive(@TenantCtx() ctx: TenantRequestContext, @Param('id', UuidParam) id: string) {
    return this.structure.setTeamStatus(ctx, id, 'archived');
  }

  @Post(':id/restore')
  @RequirePermission('team.manage')
  @HttpCode(200)
  restore(@TenantCtx() ctx: TenantRequestContext, @Param('id', UuidParam) id: string) {
    return this.structure.setTeamStatus(ctx, id, 'active');
  }

  @Post(':id/members')
  @RequirePermission('team.manage')
  addMember(
    @TenantCtx() ctx: TenantRequestContext,
    @Param('id', UuidParam) id: string,
    @Body(new ZodPipe(addTeamMemberRequest)) body: { employeeId: string },
  ) {
    return this.structure.addMember(ctx, id, body.employeeId);
  }

  @Delete(':id/members/:employeeId')
  @RequirePermission('team.manage')
  removeMember(
    @TenantCtx() ctx: TenantRequestContext,
    @Param('id', UuidParam) id: string,
    @Param('employeeId', UuidParam) employeeId: string,
  ) {
    return this.structure.removeMember(ctx, id, employeeId);
  }
}
