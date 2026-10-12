import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';

export class CreateModuleDto {
  @ApiProperty({ minLength: 1, maxLength: 200 }) @IsString() @Length(1, 200) @Matches(/\S/) title!: string;
  @ApiProperty({ minimum: 0, maximum: 999 }) @IsInt() @Min(0) @Max(999) position!: number;
}
export class CreateLessonDto extends CreateModuleDto {
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() required?: boolean;
}
export class UpdateLessonDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1,200) @Matches(/\S/) title?:string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() required?:boolean;
}
export class EnrollmentStatusDto { @ApiProperty() @IsBoolean() revoked!:boolean; }
export class EnrollmentMemberDto extends Object {
  @ApiProperty() id!:string; @ApiProperty() display_name!:string; @ApiProperty() email!:string;
  @ApiProperty({type:String,nullable:true}) revoked_at!:string|null;
}
export class LessonDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) module_id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() position!: number;
  @ApiProperty() required!: boolean;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) active_media_id!: string | null;
}
export class ModuleDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) course_id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() position!: number;
}
export class LessonDetailsDto extends LessonDto {
  @ApiProperty({ nullable: true, enum: ['UPLOADING', 'VALIDATING', 'READY', 'FAILED'] }) media_status!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) job_id!: string | null;
  @ApiProperty({ type: String, nullable: true }) error_code!: string | null;
  @ApiProperty() retryable!: boolean;
}
export class EnrollmentDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) course_id!: string;
  @ApiProperty({ format: 'uuid' }) user_id!: string;
  @ApiProperty({ format: 'date-time' }) created_at!: string;
  @ApiProperty({ nullable: true, format: 'date-time' }) revoked_at!: string | null;
}
export class UploadDto {
  @ApiProperty({ minimum: 1, maximum: 524288000 }) @IsInt() @Min(1) @Max(524288000) size_bytes!: number;
}
export class UploadResultDto {
  @ApiProperty({ format: 'uuid' }) media_id!: string;
  @ApiProperty({ format: 'uri' }) upload_url!: string;
  @ApiProperty({ enum: ['PUT'] }) method!: string;
  @ApiProperty({ example: 'video/mp4' }) content_type!: string;
  @ApiProperty({ example: 900 }) expires_in!: number;
}
export class UploadCompleteDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() media_id!: string;
}
export class JobDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) media_id!: string;
  @ApiProperty({ enum: ['PENDING','RUNNING','READY','FAILED'] }) status!: string;
  @ApiProperty() attempts!: number;
  @ApiProperty() generation!: number;
  @ApiProperty({ nullable: true }) error_code!: string | null;
  @ApiProperty() retryable!: boolean;
}
export class AcceptedJobDto {
  @ApiProperty({ format: 'uuid' }) job_id!: string;
}
export class PlaybackDto {
  @ApiProperty({ format: 'uuid' }) lesson_id!: string;
  @ApiProperty({ format: 'uuid' }) media_version!: string;
  @ApiProperty({ format: 'uri' }) url!: string;
  @ApiProperty() duration_sec!: number;
  @ApiProperty({ example: 300 }) expires_in!: number;
  @ApiProperty({ enum: ['NOT_STARTED','PROCESSING','INDEXING','READY'] }) ai_status!: string;
}
