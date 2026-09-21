export type TypedDecisionInstruction =
  | string
  | readonly unknown[]
  | Readonly<Record<string, unknown>>

export interface NoulDecisionQuestion {
  type: 'noul'
  instructions: TypedDecisionInstruction
  criteria?: Readonly<Record<string, TypedDecisionInstruction>>
}

export interface ChoiceDecisionQuestion {
  type: 'choice'
  instructions: TypedDecisionInstruction
  criteria: Readonly<Record<string, TypedDecisionInstruction | null>>
}

export interface ScoreDecisionQuestion {
  type: 'score'
  instructions: TypedDecisionInstruction
  criteria: readonly TypedDecisionInstruction[]
}

export type TypedDecisionQuestion =
  | NoulDecisionQuestion
  | ChoiceDecisionQuestion
  | ScoreDecisionQuestion

export interface NoulDecisionAnswer {
  type: 'noul'
  noul: number
}

export interface ChoiceDecisionAnswer {
  type: 'choice'
  choice: string
  probabilities: Readonly<Record<string, number>>
  confidence: number
}

export interface ScoreDecisionAnswer {
  type: 'score'
  score: number
  legend: Readonly<Record<string, string>>
  probabilities: Readonly<Record<string, number>>
  confidence: number
}

export type TypedDecisionAnswer =
  | NoulDecisionAnswer
  | ChoiceDecisionAnswer
  | ScoreDecisionAnswer

export interface TypedDecisionInput {
  state: unknown
  questions: Readonly<Record<string, TypedDecisionQuestion>>
}

export interface TypedDecisionOutput {
  answers: Readonly<Record<string, TypedDecisionAnswer>>
}
