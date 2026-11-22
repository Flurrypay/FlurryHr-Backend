import {
  IsEmail,
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
  IsIn,
  IsInt,
  Min,
  Max,
  IsUUID,
  IsBoolean,
  IsDateString,
  Matches,
  ValidateNested,
} from "class-validator";
import { Transform, Type } from "class-transformer";
import { WorkLocationDto } from "./work-location";
export class RegisterDto {
  @IsString() @MinLength(2) @MaxLength(120) fullName!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(12) @MaxLength(128) password!: string;
  @IsString() @MinLength(2) @MaxLength(150) companyName!: string;
  @Matches(/^[A-Z]{2}$/) country!: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
}
export class EmailDto {
  @IsEmail() email!: string;
}
export class TokenDto {
  @IsString() @MinLength(32) @MaxLength(200) token!: string;
}
export class ResetDto extends TokenDto {
  @IsString() @MinLength(12) @MaxLength(128) password!: string;
}
export class AcceptDto extends TokenDto {
  @IsOptional() @IsString() @MinLength(12) @MaxLength(128) password?: string;
}
export class SwitchDto {
  @IsString() @MinLength(1) membershipId!: string;
}
export class CompanyDto {
  @IsString() @MinLength(2) @MaxLength(150) name!: string;
  @IsEmail() businessEmail!: string;
  @Matches(/^[A-Z]{2}$/) country!: string;
  @IsString() @MaxLength(100) timezone!: string;
  @IsString() @MaxLength(500) address!: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsString() @MaxLength(500) logo?: string;
  @IsInt() @Min(0) @Max(6) onboardingStep!: number;
  @IsOptional() @IsBoolean() finish?: boolean;
  @IsOptional() @IsBoolean() emailNotifications?: boolean;
}
export class InviteDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => WorkLocationDto)
  remoteWorkLocation?: WorkLocationDto;
  @IsString() @MinLength(1) @MaxLength(80) firstName!: string;
  @IsString() @MinLength(1) @MaxLength(80) lastName!: string;
  @IsEmail() email!: string;
  @IsUUID() departmentId!: string;
  @IsUUID() scheduleId!: string;
  @IsOptional() @IsUUID() managerId?: string;
  @IsString() @MinLength(2) @MaxLength(100) jobTitle!: string;
  @IsIn(["HR_ADMIN", "COMPANY_ADMIN", "MANAGER", "FINANCE", "EMPLOYEE"]) role!:
    "HR_ADMIN" | "COMPANY_ADMIN" | "MANAGER" | "FINANCE" | "EMPLOYEE";
  @IsIn(["Full-time", "Part-time", "Contract", "Intern"])
  employmentType!: string;
  @IsDateString() joinedAt!: string;
  @IsIn(["Hybrid", "Remote", "On-site"]) workArrangement!: string;
}
export class SuspendDto {
  @IsIn(["Active", "Suspended"]) status!: string;
  @IsString() @MinLength(10) @MaxLength(500) reason!: string;
  @IsString() @MinLength(1) password!: string;
}
export class NoteDto {
  @IsString() @MinLength(2) @MaxLength(2000) note!: string;
}
export class CancelLeaveDto {
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}
export class HolidayDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @IsString() @MinLength(2) @MaxLength(100) name!: string;
}
export class ProfileDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName?: string;
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @MaxLength(80)
  lastName?: string;
  @IsString() @MaxLength(30) phone!: string;
  @IsOptional() @IsBoolean() emailNotifications?: boolean;
}
export class AssetDto {
  @IsString() @MinLength(2) @MaxLength(100) identifier!: string;
  @IsString() @MinLength(2) @MaxLength(150) name!: string;
  @IsOptional() @IsString() @MaxLength(100) serialNumber?: string;
}
export class AssetAssignmentDto {
  @IsOptional() @IsUUID() employeeId?: string;
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}
export class ReviewDto {
  @IsUUID() employeeId!: string;
  @IsString() @MinLength(3) @MaxLength(100) period!: string;
  @IsString() @MinLength(5) @MaxLength(3000) goal!: string;
}
export class AssessmentDto {
  @IsString() @MinLength(5) @MaxLength(5000) assessment!: string;
}
export class DocumentDto {
  @IsString() @MinLength(1) @MaxLength(150) name!: string;
  @IsIn(["Policy", "Contract", "Offer", "Payroll", "Training", "Other"])
  category!: string;
  @IsOptional() @IsUUID() employeeId?: string;
  @IsIn(["application/pdf", "image/png", "image/jpeg", "text/plain"])
  mime!: string;
  @IsString() @MaxLength(7000000) dataBase64!: string;
}
