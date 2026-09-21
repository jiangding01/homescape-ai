import type { DesignOperation } from '@homescape/domain'

export interface DesignCommandContextObject {
  id: string
  category: string
  label: string
  locked: boolean
  roomId?: string
  zoneId?: string
  width?: number
  colorFamily?: string
}

export interface DesignCommandContext {
  projectId: string
  activeRoom: {
    id: string
    name: string
  }
  objects: readonly DesignCommandContextObject[]
}

export interface DesignCommandRequest {
  requestId: string
  command: string
  context: DesignCommandContext
}

export type DesignInterpretationStatus =
  | 'ready'
  | 'needs_clarification'
  | 'unsupported'
  | 'no_change'

export interface ChoiceSignal {
  value: string
  confidence: number
}

export interface DesignDecisionSummary {
  intent: ChoiceSignal
  scope: ChoiceSignal
  target: ChoiceSignal
  category: ChoiceSignal
  size: ChoiceSignal
  color: ChoiceSignal
  seats: ChoiceSignal
  style: ChoiceSignal
  preserveOthers: number
}

export interface DesignInterpretationMeta {
  provider: string
  model: string
  latencyMs: number
  usage?: {
    inputTokens?: number
    outputTokens?: number
    cost?: number
  }
}

export interface DesignInterpretation {
  status: DesignInterpretationStatus
  message: string
  operations: DesignOperation[]
  decisions: DesignDecisionSummary
  meta: DesignInterpretationMeta
}
