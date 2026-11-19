import {
  IsString,
  IsEmail,
  MinLength,
  MaxLength,
  IsOptional,
  IsIn,
  IsUUID,
  IsDateString,
  IsInt,
  Min,
  Max,
  Matches,
  IsArray,
  ArrayNotEmpty,
  ArrayUnique,
  IsBoolean,
} from "class-validator";
export class LoginDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(1) @MaxLength(128) password!: string;
}
export class EmployeeDto {
  @IsString() @MinLength(1) @MaxLength(80) firstName!: string;
  @IsString() @MinLength(1) @MaxLength(80) lastName!: string;
  @IsEmail() email!: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsString() @MinLength(1) @MaxLength(100) jobTitle!: string;
  @IsUUID() departmentId!: string;
  @IsUUID() scheduleId!: string;
  @IsOptional() @IsUUID() managerId?: string;
  @IsDateString() joinedAt!: string;
  @IsIn(["Full-time", "Part-time", "Contract", "Intern"])
  employmentType!: string;
  @IsIn(["Remote", "Hybrid", "On-site"]) workArrangement!: string;
  @IsOptional()
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  initialPassword?: string;
}
export class StatusDto {
  @IsIn(["Active", "Inactive"]) status!: string;
  @IsOptional() @IsString() @MinLength(5) @MaxLength(1000) reason?: string;
  @IsOptional() @IsDateString() exitDate?: string;
}
export class NameDto {
  @IsString() @MinLength(2) @MaxLength(100) name!: string;
}
export class ScheduleDto {
  @IsString() @MinLength(2) @MaxLength(100) name!: string;
  @IsString() timezone!: string;
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  workingDays!: number[];
  @IsInt() @Min(0) @Max(1439) startMinute!: number;
  @IsInt() @Min(0) @Max(1439) endMinute!: number;
  @IsInt() @Min(0) @Max(120) graceMinutes!: number;
  @IsInt() @Min(0) @Max(240) breakMinutes!: number;
}
export class LeaveDto {
  @IsUUID() leaveTypeId!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) endDate!: string;
  @IsString() @MinLength(5) @MaxLength(2000) reason!: string;
}
export class DecisionDto {
  @IsIn(["Approved", "Rejected"]) status!: string;
  @IsString() @MinLength(3) @MaxLength(1000) comment!: string;
}
export class AllocationDto {
  @IsUUID() employeeId!: string;
  @IsUUID() leaveTypeId!: string;
  @IsInt() @Min(2020) @Max(2100) year!: number;
  @IsInt() @Min(0) @Max(366) days!: number;
}
export class CorrectionDto {
  @IsUUID() attendanceId!: string;
  @IsDateString() requestedIn!: string;
  @IsDateString() requestedOut!: string;
  @IsString() @MinLength(5) @MaxLength(1000) reason!: string;
}
export class AnnouncementDto {
  @IsString() @MinLength(3) @MaxLength(150) title!: string;
  @IsString() @MinLength(5) @MaxLength(5000) body!: string;
}
export class JobDto {
  @IsString() @MinLength(2) @MaxLength(120) title!: string;
  @IsString() @MinLength(2) @MaxLength(100) department!: string;
  @IsString() @MinLength(5) @MaxLength(10000) description!: string;
  @IsIn(["Remote", "Hybrid", "On-site"]) workArrangement!: string;
}
export class CandidateDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsEmail() email!: string;
  @IsUUID() jobId!: string;
}
export class StageDto {
  @IsIn([
    "Applied",
    "Screening",
    "Shortlisted",
    "Interview",
    "Offer",
    "Hired",
    "Rejected",
    "Withdrawn",
  ])
  stage!: string;
  @IsOptional() @IsBoolean() offerAccepted?: boolean;
}
export class ConvertDto {
  @IsUUID() departmentId!: string;
  @IsUUID() scheduleId!: string;
  @IsDateString() joinedAt!: string;
  @IsOptional()
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  initialPassword?: string;
}
export class TaskDto {
  @IsString() @MinLength(2) @MaxLength(200) title!: string;
  @IsString() @MaxLength(5000) description!: string;
  @IsUUID() employeeId!: string;
  @IsIn(["Low", "Medium", "High"]) priority!: string;
  @IsDateString() dueDate!: string;
}
export class TaskStatusDto {
  @IsIn(["To Do", "In Progress", "Blocked", "Completed"]) status!: string;
}
export class PayrollDto {
  @IsUUID() employeeId!: string;
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) period!: string;
  @Matches(/^\d{1,15}$/) baseMinor!: string;
  @Matches(/^\d{1,15}$/) allowancesMinor!: string;
  @Matches(/^\d{1,15}$/) deductionsMinor!: string;
}
export class RoleDto {
  @IsIn(["COMPANY_ADMIN", "HR_ADMIN", "MANAGER", "FINANCE", "EMPLOYEE"]) role!:
    "COMPANY_ADMIN" | "HR_ADMIN" | "MANAGER" | "FINANCE" | "EMPLOYEE";
}
