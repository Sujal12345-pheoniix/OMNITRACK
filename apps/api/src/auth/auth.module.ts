import { Module } from '@nestjs/common';
import { ProvisioningModule } from '../tenancy/provisioning.module';
import { AccessGuard } from './access.guard';
import { AuthController, MeController, OrganizationsCreateController } from './auth.controller';
import { AuthService } from './auth.service';
import { MeService } from './me.service';
import { MfaService } from './mfa.service';
import { PasswordService } from './password.service';
import { PrincipalService } from './principal.service';
import { SessionService } from './session.service';

@Module({
  imports: [ProvisioningModule],
  controllers: [AuthController, MeController, OrganizationsCreateController],
  providers: [AuthService, MeService, MfaService, PasswordService, PrincipalService, SessionService, AccessGuard],
  exports: [SessionService, PasswordService, PrincipalService, AccessGuard, MfaService],
})
export class AuthModule {}
