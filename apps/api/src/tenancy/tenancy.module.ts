import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InvitationsService } from './invitations.service';
import { MembersService } from './members.service';
import { OrganizationService, PlatformService } from './organization.service';
import { ProvisioningModule } from './provisioning.module';
import { RolesService } from './roles.service';
import {
  InvitationsController,
  MembersController,
  OrganizationController,
  PlatformController,
  PublicController,
  RolesController,
} from './tenancy.controller';

@Module({
  imports: [AuthModule, ProvisioningModule],
  controllers: [OrganizationController, MembersController, InvitationsController, RolesController, PlatformController, PublicController],
  providers: [OrganizationService, PlatformService, MembersService, InvitationsService, RolesService],
})
export class TenancyModule {}
