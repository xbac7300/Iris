import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

export class LoginDto {
  @ApiProperty({ format: 'email' })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail() @Length(3, 254) email!: string;

  @ApiProperty({ minLength: 12, maxLength: 128, format: 'password' })
  @IsString() @Length(12, 128) password!: string;

  @ApiProperty({ enum: ['web', 'mobile'] })
  @IsIn(['web', 'mobile']) client_type!: 'web' | 'mobile';
}
export class RegisterDto extends LoginDto {
  @ApiProperty({ minLength: 1, maxLength: 100 })
  @IsString() @Length(1, 100) @Matches(/\S/) display_name!: string;

  @ApiPropertyOptional({ enum: ['STUDENT', 'INSTRUCTOR'] })
  @IsOptional() @IsIn(['STUDENT', 'INSTRUCTOR']) role?: 'STUDENT' | 'INSTRUCTOR';
}
export class RefreshDto {
  @ApiProperty({ enum: ['web', 'mobile'] })
  @IsIn(['web', 'mobile']) client_type!: 'web' | 'mobile';

  @ApiPropertyOptional({ description: 'Chỉ mobile. Web dùng cookie HttpOnly.', minLength: 64, maxLength: 64 })
  @IsOptional() @IsString() @Matches(/^[a-f0-9]{64}$/) refresh_token?: string;
}
export class UserDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'email' }) email!: string;
  @ApiProperty() display_name!: string;
  @ApiProperty({ type: [String], enum: ['STUDENT', 'INSTRUCTOR', 'ADMIN'] }) roles!: string[];
}
export class AuthResultDto {
  @ApiProperty() access_token!: string;
  @ApiProperty({ example: 900 }) expires_in!: number;
  @ApiPropertyOptional({ description: 'Chỉ trả trong response mobile.' }) refresh_token?: string;
  @ApiProperty({ type: UserDto }) user!: UserDto;
}
export class SwitchRoleDto {
  @ApiProperty({ enum: ['STUDENT', 'INSTRUCTOR'] })
  @IsIn(['STUDENT', 'INSTRUCTOR'])
  role!: 'STUDENT' | 'INSTRUCTOR';
}

