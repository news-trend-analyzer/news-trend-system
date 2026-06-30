import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateCoupangDeeplinkDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  query: string;
}

export class SearchCoupangProductsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  query: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  limit?: number;
}
