import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
export class QuizOptionInput {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(1000) text!: string;
  @ApiProperty() @IsBoolean() is_correct!: boolean;
}
export class QuizQuestionInput {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(2000) text!: string;
  @ApiPropertyOptional({ enum: ['MULTIPLE_CHOICE', 'ESSAY', 'FILE_UPLOAD'], default: 'MULTIPLE_CHOICE' })
  @IsOptional() @IsString() question_type?: 'MULTIPLE_CHOICE' | 'ESSAY' | 'FILE_UPLOAD';
  @ApiPropertyOptional({ type: [QuizOptionInput] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => QuizOptionInput) options?: QuizOptionInput[];
}
export class QuizInputDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @ApiProperty({ default: true, type: Boolean }) @IsBoolean() required: boolean = true;
  @ApiProperty({ default: 70, type: Number }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) pass_threshold: number = 70;
  @ApiProperty({ default: 3, type: Number }) @IsInt() @Min(1) @Max(3) max_attempts: number = 3;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) @IsOptional() @IsUUID() module_id?: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) @IsOptional() @IsUUID() lesson_id?: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Giới hạn thời gian (phút), null hoặc 0 là không giới hạn' })
  @IsOptional() @IsInt() @Min(0) @Max(300) time_limit_minutes?: number | null;
  @ApiProperty({ type: [QuizQuestionInput] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => QuizQuestionInput) questions!: QuizQuestionInput[];
}
export class QuizOptionDto { @ApiProperty() id!: string; @ApiProperty() text!: string; }
export class QuizQuestionDto {
  @ApiProperty() id!: string;
  @ApiProperty() text!: string;
  @ApiProperty({ enum: ['MULTIPLE_CHOICE', 'ESSAY', 'FILE_UPLOAD'] }) question_type!: 'MULTIPLE_CHOICE' | 'ESSAY' | 'FILE_UPLOAD';
  @ApiProperty({ type: [QuizOptionDto] }) options!: QuizOptionDto[];
}
export class QuizDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() required!: boolean;
  @ApiProperty() pass_threshold!: number;
  @ApiProperty() max_attempts!: number;
  @ApiPropertyOptional({ type: Number, nullable: true }) time_limit_minutes?: number | null;
  @ApiProperty() status!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) module_id?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) lesson_id?: string | null;
  @ApiProperty({ type: [QuizQuestionDto] }) questions!: QuizQuestionDto[];
}
export class AnswerInputDto {
  @ApiProperty() @IsUUID() question_id!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) @IsOptional() @IsUUID() option_id?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) @IsOptional() @IsString() @MaxLength(5000) text_response?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) @IsOptional() @IsString() @MaxLength(1000) file_url?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) @IsOptional() @IsString() @MaxLength(300) file_name?: string | null;
}
export class SubmitDto {
  @ApiProperty() @IsUUID() idempotency_key!: string;
  @ApiProperty({ type: [AnswerInputDto] }) @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => AnswerInputDto) answers!: AnswerInputDto[];
}
export class AttemptDto {
  @ApiProperty() id!: string;
  @ApiProperty() quiz_id!: string;
  @ApiProperty() status!: string;
  @ApiProperty() attempt_number!: number;
  @ApiProperty() pass_threshold!: number;
  @ApiProperty() max_attempts!: number;
  @ApiProperty({ type: Number, nullable: true }) correct_count!: number | null;
  @ApiProperty({ type: Number, nullable: true }) question_count!: number | null;
  @ApiProperty({ type: Number, nullable: true }) score!: number | null;
  @ApiProperty({ type: Boolean, nullable: true }) passed!: boolean | null;
}
export class WatchEventDto {
  @ApiProperty() @IsUUID() event_id!:string; @ApiProperty() @IsUUID() session_id!:string; @ApiProperty() @IsUUID() media_version!:string;
  @ApiProperty() @IsInt() @Min(0) sequence!:number; @ApiProperty() @IsNumber() @Min(0) start_sec!:number;
  @ApiProperty() @IsNumber() @Min(0) end_sec!:number; @ApiProperty() @IsNumber() @Min(0.25) @Max(2) playback_rate!:number;
  @ApiProperty() @IsNumber() @Min(1) @Max(120000) elapsed_ms!:number;
}
export class WatchBatchDto {
  @ApiProperty({type:[WatchEventDto]}) @IsArray() @ArrayMaxSize(100) @ValidateNested({each:true}) @Type(()=>WatchEventDto) events!:WatchEventDto[];
  @ApiProperty() @IsUUID() session_id!:string; @ApiProperty() @IsUUID() media_version!:string;
  @ApiProperty() @IsInt() @Min(0) resume_revision!:number; @ApiProperty() @IsNumber() @Min(0) position_sec!:number;
}
export class PlaybackSessionDto { @ApiProperty() session_id!:string; @ApiProperty() media_version!:string; @ApiProperty() resume_revision!:number; @ApiProperty() position_sec!:number; }
export class RejectedWatchDto { @ApiProperty() event_id!:string; @ApiProperty() reason!:string; }
export class WatchResultDto {
  @ApiProperty({type:[String]}) accepted!:string[]; @ApiProperty({type:[String]}) duplicate!:string[]; @ApiProperty({type:[RejectedWatchDto]}) rejected!:RejectedWatchDto[];
  @ApiProperty() resume_revision!:number; @ApiProperty() checkpoint_applied!:boolean; @ApiProperty() watched_ratio!:number;
  @ApiProperty() session_current!:boolean;
}
export class LessonProgressDto { @ApiProperty() lesson_id!:string; @ApiProperty() title!:string; @ApiProperty() watched_ratio!:number; @ApiProperty() complete!:boolean; @ApiProperty() required!:boolean; }
export class QuizProgressDto { @ApiProperty() quiz_id!:string; @ApiProperty() title!:string; @ApiProperty() passed!:boolean; @ApiProperty() required!:boolean; @ApiProperty({type:Number,nullable:true}) best_score!:number|null; }
export class CourseProgressDto { @ApiProperty({type:[LessonProgressDto]}) lessons!:LessonProgressDto[]; @ApiProperty({type:[QuizProgressDto]}) quizzes!:QuizProgressDto[]; @ApiProperty() required_count!:number; @ApiProperty() completed_count!:number; @ApiProperty() complete!:boolean; }
export class AnalyticsDto { @ApiProperty() cohort!:string; @ApiProperty() enrolled!:number; @ApiProperty() completed!:number; @ApiProperty() submitted!:number; @ApiProperty() not_submitted!:number; @ApiProperty({type:Number,nullable:true}) average_best_score!:number|null; @ApiProperty() measured_at!:string; }
