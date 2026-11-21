import { BadRequestException, ForbiddenException } from "@nestjs/common";
import {
  IsNumber,
  IsString,
  Min,
  Max,
  MinLength,
  MaxLength,
  IsInt,
} from "class-validator";
export const ATTENDANCE_RADIUS_METRES = 100;
export class WorkLocationDto {
  [key: string]: string | number;
  @IsString() @MinLength(5) @MaxLength(500) address!: string;
  @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @IsNumber() @Min(-180) @Max(180) longitude!: number;
}
export class AttendancePositionDto {
  @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @IsNumber() @Min(0) @Max(50) accuracy!: number;
  @IsInt() @Min(0) capturedAt!: number;
}
export function locationValue(value: unknown): WorkLocationDto | null {
  if (!value || typeof value !== "object") return null;
  const v = value as WorkLocationDto;
  return typeof v.address === "string" &&
    v.address.trim().length >= 5 &&
    Number.isFinite(v.latitude) &&
    Math.abs(v.latitude) <= 90 &&
    Number.isFinite(v.longitude) &&
    Math.abs(v.longitude) <= 180
    ? v
    : null;
}
export function verifyPosition(
  position: AttendancePositionDto,
  location: unknown,
  kind: string,
  now = Date.now(),
) {
  const target = locationValue(location);
  if (!target)
    throw new ForbiddenException(
      `Ask HR to configure your approved ${kind === "Remote" ? "remote work" : "company attendance"} location before marking attendance`,
    );
  if (
    !position ||
    !Number.isFinite(position.latitude) ||
    Math.abs(position.latitude) > 90 ||
    !Number.isFinite(position.longitude) ||
    Math.abs(position.longitude) > 180 ||
    !Number.isFinite(position.accuracy) ||
    position.accuracy < 0 ||
    position.accuracy > 50
  )
    throw new BadRequestException(
      "Allow precise location access and retry; GPS accuracy must be within 50 metres",
    );
  if (
    !Number.isSafeInteger(position.capturedAt) ||
    now - position.capturedAt > 120000 ||
    position.capturedAt > now + 10000
  )
    throw new BadRequestException(
      "Your location reading is out of date. Please retry",
    );
  const radians = (n: number) => (n * Math.PI) / 180;
  const lat = radians(position.latitude - target.latitude),
    lon = radians(position.longitude - target.longitude);
  const a =
    Math.sin(lat / 2) ** 2 +
    Math.cos(radians(target.latitude)) *
      Math.cos(radians(position.latitude)) *
      Math.sin(lon / 2) ** 2;
  const distance =
    6371000 *
    2 *
    Math.atan2(Math.sqrt(Math.min(1, a)), Math.sqrt(Math.max(0, 1 - a)));
  if (distance + position.accuracy > ATTENDANCE_RADIUS_METRES)
    throw new ForbiddenException(
      `You must be within 100 metres of your approved ${kind === "Remote" ? "remote work" : "company"} location. Move closer or improve GPS accuracy and retry`,
    );
  // Store a verification receipt, not a continuous location trail or raw device coordinates.
  return {
    kind,
    radiusMetres: ATTENDANCE_RADIUS_METRES,
    distanceMetres: Math.round(distance),
    accuracyMetres: position.accuracy,
    capturedAt: new Date(position.capturedAt).toISOString(),
    verifiedAt: new Date(now).toISOString(),
  };
}
