import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Res } from '@nestjs/common';
import {
  acceptInvitationRequest,
  assignRolesRequest,
  createInvitationRequest,
  platformCreateOrganizationRequest,
  roleRequest,
  updateOrganizationRequest,
  updateRoleRequest,
} from '@omnitrack/contracts';
import type { Response } from 'express';
import { z } from 'zod';
import type { RequestContext, TenantRequestContext } from '../common/context';
import { Ctx, PlatformAdmin, Public, RequirePermission, TenantCtx } from '../common/decorators';
import { UuidParam, ZodPipe } from '../common/zod.pipe';
import { InvitationsService } from './invitations.service';
import { MembersService } from './members.service';
import { OrganizationService, PlatformService } from './organization.service';
import { RolesService } from './roles.service';

@Controller('organization')
export class OrganizationController {
  constructor(private readonly orgs: OrganizationService) {}

  @Get()
  @RequirePermission('organization.read')
  get(@TenantCtx() ctx: TenantRequestContext) {
    return this.orgs.get(ctx);
  }

  @Patch()
  @RequirePermission('organization.update')
  update(@TenantCtx() ctx: TenantRequestContext, @Body(new ZodPipe(updateOrganizationRequest)) body: z.infer<typeof updateOrganizationRequest>) {
    return this.orgs.update(ctx, body);
  }
}

@Controller('members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @RequirePermission('member.read')
  list(@TenantCtx() ctx: TenantRequestContext) {
    return this.members.list(ctx);
  }

  @Get(':id')
  @RequirePermission('member.read')
  get(@TenantCtx() ctx: TenantRequestContext, @Param('id', UuidParam) id: string) {
    return this.members.get(ctx, id);
  }

  @Post(':id/deactivate')
  @RequirePermission('member.deactivate')
  @HttpCode(200)
  deactivate(@TenantCtx() ctx: TenantRequestContext, @Param('id', UuidParam) id: string) {
    return this.members.setStatus(ctx, id, 'deactivated');
  }

  @Post(':id/reactivate')
  @RequirePermission('member.deactivate')
  @HttpCode(200)
  reactivate(@TenantCtx() ctx: TenantRequestContext, @Param('id', UuidParam) id: string) {
    return this.members.setStatus(ctx, id, 'active');
  }

  @Put(':id/roles')
  @RequirePermission('member.roles.assign')
  assignRoles(
    @TenantCtx() ctx: TenantRequestContext,
    @Param('id', UuidParam) id: string,
    @Body(new ZodPipe(assignRolesRequest)) body: { roleIds: string[] },
  ) {
    return this.members.assignRoles(ctx, id, body.roleIds);
  }
}

@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get()
  @RequirePermission('member.invite')
  list(@TenantCtx() ctx: TenantRequestContext) {
    return this.invitations.list(ctx);
  }

  @Post()
  @RequirePermission('member.invite')
  create(@TenantCtx() ctx: TenantRequestContext, @Body(new ZodPipe(createInvitationRequest)) body: z.infer<typeof createInvitationRequest>) {
    return this.invitations.create(ctx, body);
  }

  @Delete(':id')
  @RequirePermission('member.invite')
  @HttpCode(204)
  async revoke(@TenantCtx() ctx: TenantRequestContext, @Param('id', UuidParam) id: string) {
    await this.invitations.revoke(ctx, id);
  }

  /** Public: shows who invited whom, so the person can decide. */
  @Post('preview')
  @Public()
  @HttpCode(200)
  preview(@Body(new ZodPipe(z.object({ token: z.string().min(20).max(200) }).strict())) body: { token: string }) {
    return this.invitations.preview(body.token);
  }

  @Post('accept')
  @Public()
  @HttpCode(200)
  accept(
    @Ctx() ctx: RequestContext,
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodPipe(acceptInvitationRequest)) body: z.infer<typeof acceptInvitationRequest>,
  ) {
    return this.invitations.accept(ctx, res, body);
  }
}

@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('permissions')
  @RequirePermission('role.read')
  catalog() {
    return this.roles.catalog();
  }

  @Get('roles')
  @RequirePermission('role.read')
  list(@TenantCtx() ctx: TenantRequestContext) {
    return this.roles.list(ctx);
  }

  @Get('roles/:id')
  @RequirePermission('role.read')
  get(@TenantCtx() ctx: TenantRequestContext, @Param('id', UuidParam) id: string) {
    return this.roles.get(ctx, id);
  }

  @Post('roles')
  @RequirePermission('role.manage')
  create(@TenantCtx() ctx: TenantRequestContext, @Body(new ZodPipe(roleRequest)) body: z.infer<typeof roleRequest>) {
    return this.roles.create(ctx, body);
  }

  @Patch('roles/:id')
  @RequirePermission('role.manage')
  update(
    @TenantCtx() ctx: TenantRequestContext,
    @Param('id', UuidParam) id: string,
    @Body(new ZodPipe(updateRoleRequest)) body: z.infer<typeof updateRoleRequest>,
  ) {
    return this.roles.update(ctx, id, body);
  }

  @Delete('roles/:id')
  @RequirePermission('role.manage')
  @HttpCode(204)
  async remove(@TenantCtx() ctx: TenantRequestContext, @Param('id', UuidParam) id: string) {
    await this.roles.remove(ctx, id);
  }
}

@Controller('platform/organizations')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get()
  @PlatformAdmin()
  list() {
    return this.platform.list();
  }

  @Post()
  @PlatformAdmin()
  create(@Ctx() ctx: RequestContext, @Body(new ZodPipe(platformCreateOrganizationRequest)) body: z.infer<typeof platformCreateOrganizationRequest>) {
    return this.platform.create(ctx, body);
  }

  @Post(':id/suspend')
  @PlatformAdmin()
  @HttpCode(200)
  suspend(@Ctx() ctx: RequestContext, @Param('id', UuidParam) id: string) {
    return this.platform.setStatus(ctx, id, 'suspended');
  }

  @Post(':id/reactivate')
  @PlatformAdmin()
  @HttpCode(200)
  reactivate(@Ctx() ctx: RequestContext, @Param('id', UuidParam) id: string) {
    return this.platform.setStatus(ctx, id, 'active');
  }
}

@Controller('public')
export class PublicController {
  constructor(private readonly orgs: OrganizationService) {}

  @Get('organizations/:slug')
  @Public()
  profile(@Param('slug') slug: string) {
    return this.orgs.publicProfile(slug.slice(0, 40));
  }
}
