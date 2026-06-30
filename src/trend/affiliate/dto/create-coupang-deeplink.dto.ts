import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateCoupangDeeplinkDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  query: string;
}
