import { IsIn, IsString, MinLength } from "class-validator";

export class JoinSessionDtoClass {
  @IsString()
  @MinLength(1)
  displayName!: string;

  @IsString()
  @MinLength(1)
  avatar!: string;
}

export class SelectJamDtoClass {
  @IsString()
  gameVersionId!: string;
}

export { JoinSessionDtoClass as JoinJamDtoClass, SelectJamDtoClass as SelectGameDtoClass };

export class SubmitInterestResponseDtoClass {
  @IsIn(["continue_learning", "not_interested"])
  response!: "continue_learning" | "not_interested";
}

