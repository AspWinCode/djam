import { Type } from "class-transformer";
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEmail,
  IsHexColor,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength
} from "class-validator";

export class CreateJamDtoClass {
  @IsString()
  @MinLength(2)
  slug!: string;

  @IsOptional()
  @IsBoolean()
  isTemplate?: boolean;

  @IsString()
  @MinLength(2)
  title!: string;

  @IsString()
  @MinLength(2)
  shortDescription!: string;

  @IsString()
  @MinLength(2)
  fullDescription!: string;

  @IsString()
  themeCode!: string;

  @IsString()
  level!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  estimatedDurationMin!: number;

  @IsString()
  accentStyle!: string;

  @IsHexColor()
  accentColor!: string;

  @IsOptional()
  @IsString()
  coverImageUrl?: string;

  @IsOptional()
  @IsString()
  previewVideoUrl?: string;

  @IsString()
  @MinLength(2)
  finalTitle!: string;

  @IsString()
  @MinLength(2)
  finalDescription!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  finalRewardXp!: number;
}

export class UpdateJamDtoClass {
  @IsOptional()
  @IsString()
  expectedUpdatedAt?: string;

  @IsOptional()
  @IsBoolean()
  isTemplate?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(2)
  slug?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  shortDescription?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  fullDescription?: string;

  @IsOptional()
  @IsString()
  themeCode?: string;

  @IsOptional()
  @IsString()
  level?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  estimatedDurationMin?: number;

  @IsOptional()
  @IsString()
  accentStyle?: string;

  @IsOptional()
  @IsHexColor()
  accentColor?: string;

  @IsOptional()
  @IsString()
  coverImageUrl?: string;

  @IsOptional()
  @IsString()
  previewVideoUrl?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  finalTitle?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  finalDescription?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  finalRewardXp?: number;
}

export class CreateStepDtoClass {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsString()
  description!: string;

  @IsString()
  goalText!: string;

  @IsOptional()
  @IsString()
  taskImageUrl?: string;

  @IsOptional()
  @IsString()
  taskVideoUrl?: string;

  @IsString()
  successTitle!: string;

  @IsString()
  successText!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  successXp!: number;

  @IsOptional()
  @IsString()
  resultVideoUrl?: string;

  @IsOptional()
  @IsString()
  resultImageUrl?: string;

  @IsOptional()
  @IsBoolean()
  isBonus?: boolean;
}

export class UpdateStepDtoClass extends CreateStepDtoClass {
  @IsOptional()
  @IsString()
  expectedUpdatedAt?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateHintDtoClass {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9)
  level!: number;

  @IsString()
  @MinLength(1)
  text!: string;

  @IsIn(["text", "image", "video"])
  hintType!: "text" | "image" | "video";

  @IsOptional()
  @IsString()
  mediaUrl?: string;
}

export class UpdateHintDtoClass {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9)
  level?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  text?: string;

  @IsOptional()
  @IsIn(["text", "image", "video"])
  hintType?: "text" | "image" | "video";

  @IsOptional()
  @IsString()
  mediaUrl?: string;
}

export class ReorderStepsDtoClass {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  stepIds!: string[];
}

export class UploadMediaDtoClass {
  @IsIn(["image", "video", "file"])
  type!: "image" | "video" | "file";

  @IsString()
  @MinLength(1)
  filename!: string;

  @IsString()
  @MinLength(1)
  mimeType!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  sizeBytes!: number;
}

export class CreateUserDtoClass {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(2)
  displayName!: string;

  @IsIn(["admin", "trainer"])
  role!: "admin" | "trainer";

  @IsString()
  @MinLength(6)
  password!: string;

  @IsOptional()
  @IsString()
  organizationId?: string;
}

export class UpdateUserDtoClass {
  @IsOptional()
  @IsString()
  @MinLength(2)
  displayName?: string;

  @IsOptional()
  @IsIn(["admin", "trainer"])
  role?: "admin" | "trainer";
}

export class ResetUserPasswordDtoClass {
  @IsString()
  @MinLength(6)
  password!: string;
}

export class CreateOrganizationDtoClass {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @MinLength(2)
  slug!: string;

  @IsOptional()
  @IsIn(["starter", "growth", "school"])
  planKey?: "starter" | "growth" | "school";

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  brandMessage?: string;

  @IsOptional()
  @IsString()
  @MinLength(4)
  brandAccentColor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxStorageBytes?: number;
}

export class UpdateOrganizationDtoClass {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  slug?: string;

  @IsOptional()
  @IsIn(["starter", "growth", "school"])
  planKey?: "starter" | "growth" | "school";

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  brandMessage?: string;

  @IsOptional()
  @IsString()
  @MinLength(4)
  brandAccentColor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxAdminUsers?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxTrainerUsers?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxActiveSessions?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxPublishedJams?: number;
}

export class CreateSupportCaseDtoClass {
  @IsString()
  organizationId!: string;

  @IsString()
  @MinLength(2)
  title!: string;

  @IsString()
  @MinLength(2)
  body!: string;

  @IsIn(["low", "medium", "high"])
  severity!: "low" | "medium" | "high";
}

export class UpdateSupportCaseDtoClass {
  @IsOptional()
  @IsIn(["open", "investigating", "resolved"])
  status?: "open" | "investigating" | "resolved";
}

export class CreateSupportCaseCommentDtoClass {
  @IsString()
  @MinLength(2)
  body!: string;
}

export class CreateIncidentDtoClass {
  @IsString()
  organizationId!: string;

  @IsString()
  @MinLength(2)
  title!: string;

  @IsString()
  @MinLength(2)
  message!: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  impact?: string;

  @IsIn(["healthy", "degraded", "outage", "resolved"])
  status!: "healthy" | "degraded" | "outage" | "resolved";
}

export class UpdateIncidentDtoClass {
  @IsOptional()
  @IsString()
  @MinLength(2)
  message?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  impact?: string;

  @IsOptional()
  @IsIn(["healthy", "degraded", "outage", "resolved"])
  status?: "healthy" | "degraded" | "outage" | "resolved";
}

export { CreateJamDtoClass as CreateGameDtoClass, UpdateJamDtoClass as UpdateGameDtoClass };

export class CreateInviteDtoClass {
  @IsString()
  organizationId!: string;

  @IsEmail()
  email!: string;

  @IsIn(["admin", "trainer"])
  role!: "admin" | "trainer";

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  expiresInDays?: number;
}
