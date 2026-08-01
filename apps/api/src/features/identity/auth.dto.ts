import { IsString, Length, Matches } from 'class-validator';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_REGEX,
} from './auth.service';

export class LocalLoginDto {
  @IsString()
  @Length(3, 32)
  username!: string;

  @IsString()
  @Length(1, PASSWORD_MAX_LENGTH)
  password!: string;
}

export class RegisterLocalAccountDto {
  @IsString()
  @Matches(USERNAME_REGEX, {
    message:
      'Benutzername: 3-32 Zeichen, Kleinbuchstaben, Ziffern und . _ - (Start mit Buchstabe oder Ziffer)',
  })
  username!: string;

  @IsString()
  @Length(1, 80)
  displayName!: string;

  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, {
    message: `Passwort muss zwischen ${PASSWORD_MIN_LENGTH} und ${PASSWORD_MAX_LENGTH} Zeichen lang sein`,
  })
  password!: string;
}
