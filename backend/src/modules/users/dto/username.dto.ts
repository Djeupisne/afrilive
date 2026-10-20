import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** @handle : minuscules, chiffres, underscore et point, ne commence pas par un point. */
export const USERNAME_REGEX = /^[a-z0-9][a-z0-9._]{2,29}$/;

export class UpdateUsernameDto {
  @ApiProperty({ example: 'awa_diarra', minLength: 3, maxLength: 30 })
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Matches(USERNAME_REGEX, {
    message: 'username : 3-30 caractères, minuscules/chiffres/./_, doit commencer par lettre ou chiffre',
  })
  username!: string;
}
