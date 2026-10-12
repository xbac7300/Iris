import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateNested } from 'class-validator';
export class SegmentDto {
  @ApiProperty() @IsNumber() @Min(0) start_sec!: number;
  @ApiProperty() @IsNumber() @Min(0) end_sec!: number;
  @ApiProperty() @IsString() @Length(1,10000) text!: string;
}
export class TranscriptInputDto {
  @ApiProperty({type:[SegmentDto]}) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10000) @ValidateNested({each:true}) @Type(()=>SegmentDto) segments!: SegmentDto[];
  @ApiProperty({default:'vi'}) @IsString() @Length(2,10) language!: string;
  @ApiPropertyOptional({format:'uuid'}) @IsOptional() @IsUUID() expected_transcript_id?: string;
}
export class TranscriptDto {
  @ApiProperty({format:'uuid'}) id!: string;
  @ApiProperty({format:'uuid'}) media_id!: string;
  @ApiProperty() version!: number;
  @ApiProperty() language!: string;
  @ApiProperty({type:[SegmentDto]}) segments!: SegmentDto[];
}
export class SubtitleInputDto {
  @ApiProperty() @IsString() @Length(1,1000000) content!:string;
  @ApiProperty({default:'vi'}) @IsString() @Length(2,10) language!:string;
  @ApiPropertyOptional({format:'uuid'}) @IsOptional() @IsUUID() expected_transcript_id?:string;
}
export class AiTaskDto {
  @ApiProperty({format:'uuid'}) id!: string;
  @ApiProperty() stage!: string;
  @ApiProperty() status!: string;
  @ApiProperty() attempts!: number;
  @ApiProperty({type:String,nullable:true}) error_code!: string|null;
}
export class AiStatusDto {
  @ApiProperty({type:String,nullable:true,format:'uuid'}) transcript_id!: string|null;
  @ApiProperty({type:String,nullable:true,format:'uuid'}) index_id!: string|null;
  @ApiProperty({type:[AiTaskDto]}) tasks!: AiTaskDto[];
}
export class CitationDto {
  @ApiProperty({format:'uuid'}) lesson_id!: string;
  @ApiProperty({format:'uuid'}) media_version!: string;
  @ApiProperty({format:'uuid'}) transcript_version!: string;
  @ApiProperty({format:'uuid'}) chunk_id!: string;
  @ApiProperty() start_sec!: number;
  @ApiProperty() end_sec!: number;
  @ApiProperty() excerpt!: string;
}
export class ChatInputDto {
  @ApiProperty() @IsString() @Length(1,1500) question!: string;
  @ApiProperty({format:'uuid'}) @IsUUID() request_key!: string;
  @ApiPropertyOptional({format:'uuid'}) @IsOptional() @IsUUID() conversation_id?: string;
}
export class ChatDto {
  @ApiProperty({format:'uuid'}) id!: string;
  @ApiProperty({format:'uuid'}) conversation_id!: string;
  @ApiProperty({format:'uuid'}) index_version!: string;
  @ApiProperty() question!: string;
  @ApiProperty() answer!: string;
  @ApiProperty({enum:['SUPPORTED','INSUFFICIENT']}) evidence_status!: string;
  @ApiProperty({type:[CitationDto]}) citations!: CitationDto[];
}
export class SummarySectionDto {
  @ApiProperty() answer!: string;
  @ApiProperty({type:[CitationDto]}) citations!: CitationDto[];
}
export class SummaryDto {
  @ApiProperty({enum:['PENDING','READY','FAILED','STALE']}) status!: string;
  @ApiProperty({type:[SummarySectionDto]}) sections!: SummarySectionDto[];
}
export class LessonScopeDto {
  @ApiProperty({format:'uuid'}) @IsUUID() lesson_id!: string;
  @ApiPropertyOptional({default:20}) @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(50) limit: number = 20;
}
