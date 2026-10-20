import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Matches } from 'class-validator';

const PHONE_REGEX = /^\+[1-9]\d{7,14}$/;

export class AddPhoneDto {
  @ApiProperty({ example: '+2250712345678' })
  @IsString()
  @Matches(PHONE_REGEX, { message: 'phone doit être au format E.164' })
  phone!: string;
}

export class AddEmailDto {
  @ApiProperty({ example: 'awa@example.com' })
  @IsEmail()
  email!: string;
}
