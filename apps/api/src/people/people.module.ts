import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmployeesService } from './employees.service';
import { DepartmentsController, EmployeesController, TeamsController } from './people.controller';
import { StructureService } from './structure.service';

@Module({
  imports: [AuthModule],
  controllers: [EmployeesController, DepartmentsController, TeamsController],
  providers: [EmployeesService, StructureService],
  exports: [EmployeesService],
})
export class PeopleModule {}
