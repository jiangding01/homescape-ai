import {
  type AIProviderRegistry,
  type ChoiceDecisionAnswer,
  type NoulDecisionAnswer,
  type TypedDecisionInput,
  type TypedDecisionOutput,
  type TypedDecisionQuestion,
} from '@homescape/ai-runtime'
import type { DesignOperation } from '@homescape/domain'
import type {
  ChoiceSignal,
  DesignCommandContextObject,
  DesignCommandRequest,
  DesignDecisionSummary,
  DesignInterpretation,
} from './types'

export interface DesignCommandInterpreterOptions {
  providerHint?: string
  modelHint?: string
  intentConfidenceThreshold?: number
  targetConfidenceThreshold?: number
}

function choice(
  output: TypedDecisionOutput,
  questionId: string,
): ChoiceDecisionAnswer {
  const answer = output.answers[questionId]
  if (!answer || answer.type !== 'choice') {
    throw new Error('typed_decision 缺少 Choice：' + questionId)
  }
  return answer
}

function noul(
  output: TypedDecisionOutput,
  questionId: string,
): NoulDecisionAnswer {
  const answer = output.answers[questionId]
  if (!answer || answer.type !== 'noul') {
    throw new Error('typed_decision 缺少 Noul：' + questionId)
  }
  return answer
}

function signal(answer: ChoiceDecisionAnswer): ChoiceSignal {
  return { value: answer.choice, confidence: answer.confidence }
}

function colorFamily(value: string) {
  const mapping: Readonly<Record<string, string>> = {
    light_gray: 'light-gray',
    warm_gray: 'warm-gray',
    warm_white: 'warm-white',
    beige: 'beige',
    black: 'black',
  }
  return mapping[value]
}

function seats(value: string) {
  const mapping: Readonly<Record<string, number>> = {
    two: 2,
    three: 3,
    four: 4,
  }
  return mapping[value]
}

function currentObject(
  request: DesignCommandRequest,
  targetId: string | undefined,
) {
  if (!targetId) return undefined
  return request.context.objects.find((object) => object.id === targetId)
}

function objectRequirements(
  decisions: DesignDecisionSummary,
  object: DesignCommandContextObject | undefined,
) {
  const requirements: Record<string, unknown> = {}

  if (decisions.size.value === 'smaller' && object?.width !== undefined) {
    requirements.maxWidth = Math.max(0.4, object.width - 0.05)
  } else if (decisions.size.value === 'larger' && object?.width !== undefined) {
    requirements.minWidth = object.width + 0.05
  }

  const selectedColor = colorFamily(decisions.color.value)
  if (selectedColor) requirements.colorFamily = selectedColor

  const selectedSeats = seats(decisions.seats.value)
  if (selectedSeats !== undefined) requirements.minSeats = selectedSeats

  if (decisions.style.value === 'warm_modern') {
    requirements.style = 'warm-modern'
  }

  return requirements
}

function preserveOperations(
  request: DesignCommandRequest,
  excludedTargetId: string | undefined,
) {
  return request.context.objects
    .filter((object) => object.id !== excludedTargetId)
    .map(
      (object): DesignOperation => ({
        id: request.requestId + '-preserve-' + object.id,
        type: 'preserve',
        source: 'ai',
        scope: { type: 'object', objectId: object.id },
        targetId: object.id,
      }),
    )
}

function targetCriteria(request: DesignCommandRequest) {
  const criteria: Record<string, string | null> = {
    none: '没有明确指向现有家具',
    current_room: '用户是在说当前房间整体，而不是某一个现有家具',
  }

  for (const object of request.context.objects) {
    criteria[object.id] =
      object.label +
      '；品类=' +
      object.category +
      (object.colorFamily ? '；颜色=' + object.colorFamily : '') +
      (object.locked ? '；当前已锁定' : '')
  }

  return criteria
}

function createDecisionInput(request: DesignCommandRequest): TypedDecisionInput {
  const questions: Record<string, TypedDecisionQuestion> = {
    intent: {
      type: 'choice',
      instructions: '判断用户这一次对家装设计方案的主要操作意图。一次只选择最主要的动作。',
      criteria: {
        initial_layout: '为空房间生成或布置第一版基础家具方案，例如“帮我布置一下客厅”',
        add_object: '在现有方案中新增一种家具或装饰，例如“加一盆绿植”',
        replace_object: '把一个现有家具换成另一个满足新要求的同类商品，包括变小、变大、换颜色、换款式',
        remove_object: '删除一个现有家具',
        lock_object: '锁定一个现有家具，后续自动设计不能修改它',
        unlock_object: '解除一个现有家具的锁定',
        style_change: '修改当前房间整体风格意图，而不是只替换某个家具',
        move_object: '要求移动现有家具的位置',
        rotate_object: '要求旋转现有家具',
        unknown: '不属于以上设计操作，或者意图不足以安全执行',
      },
    },
    scope: {
      type: 'choice',
      instructions: '用户希望这次修改影响多大的设计范围？',
      criteria: {
        project: '整套住宅或全局设计语言',
        room: '当前房间整体',
        object: '某一个明确家具或对象',
        unknown: '无法判断影响范围',
      },
    },
    target: {
      type: 'choice',
      instructions: '如果用户指向当前方案中的某个现有对象，选择最符合的对象；否则选择 none 或 current_room。',
      criteria: targetCriteria(request),
    },
    category: {
      type: 'choice',
      instructions: '如果请求涉及新增或某类家具，判断最相关的家具品类。与现有对象替换无关时也可以选择 none。',
      criteria: {
        sofa: '沙发',
        coffee_table: '茶几',
        plant: '绿植',
        floor_lamp: '落地灯',
        none: '没有明确家具品类',
      },
    },
    size: {
      type: 'choice',
      instructions: '用户对目标家具尺寸的要求是什么？',
      criteria: {
        smaller: '明确要求更小、更紧凑、少占空间',
        larger: '明确要求更大、更宽、更舒展',
        keep: '明确要求尺寸保持不变',
        unspecified: '没有尺寸要求',
      },
    },
    color: {
      type: 'choice',
      instructions: '用户明确要求的目标颜色是什么？',
      criteria: {
        light_gray: '浅灰色',
        warm_gray: '暖灰色',
        beige: '米白或米色',
        warm_white: '暖白色',
        black: '黑色',
        keep: '明确要求保留原颜色',
        unspecified: '没有明确颜色要求或不在上述颜色中',
      },
    },
    seats: {
      type: 'choice',
      instructions: '如果目标是沙发，用户要求几人位？',
      criteria: {
        two: '两人位',
        three: '三人位',
        four: '四人位或更大',
        keep: '明确要求保持当前座位数',
        unspecified: '没有明确座位数',
      },
    },
    style: {
      type: 'choice',
      instructions: '用户明确表达的整体设计风格最接近哪一种？',
      criteria: {
        warm_modern: '现代原木、温暖现代、自然木质',
        minimal: '极简、克制、少装饰',
        japandi: '日式与北欧融合、侘寂或 Japandi',
        modern: '现代风，但没有明显原木倾向',
        keep: '明确要求保持现有风格',
        unspecified: '没有明确风格要求',
      },
    },
    preserve_others: {
      type: 'noul',
      instructions: '用户是否明确要求除目标对象外其他家具或其他部分保持不变？例如“其他地方别动”“其余保持原样”。',
    },
  }

  return {
    state: {
      request: request.command,
      active_room: request.context.activeRoom,
      current_objects: request.context.objects,
    },
    questions,
  }
}

export class DesignCommandInterpreter {
  private readonly providerHint: string | undefined
  private readonly modelHint: string | undefined
  private readonly intentConfidenceThreshold: number
  private readonly targetConfidenceThreshold: number

  constructor(
    private readonly ai: AIProviderRegistry,
    options: DesignCommandInterpreterOptions = {},
  ) {
    this.providerHint = options.providerHint
    this.modelHint = options.modelHint
    this.intentConfidenceThreshold = options.intentConfidenceThreshold ?? 0.4
    this.targetConfidenceThreshold = options.targetConfidenceThreshold ?? 0.3
  }

  async interpret(request: DesignCommandRequest): Promise<DesignInterpretation> {
    const command = request.command.trim()
    if (!command) throw new Error('设计指令不能为空')

    const result = await this.ai.execute<TypedDecisionInput, TypedDecisionOutput>({
      capability: 'typed_decision',
      input: createDecisionInput({ ...request, command }),
      ...(this.providerHint ? { providerHint: this.providerHint } : {}),
      ...(this.modelHint ? { modelHint: this.modelHint } : {}),
      timeoutMs: 5000,
    })

    const decisions: DesignDecisionSummary = {
      intent: signal(choice(result.data, 'intent')),
      scope: signal(choice(result.data, 'scope')),
      target: signal(choice(result.data, 'target')),
      category: signal(choice(result.data, 'category')),
      size: signal(choice(result.data, 'size')),
      color: signal(choice(result.data, 'color')),
      seats: signal(choice(result.data, 'seats')),
      style: signal(choice(result.data, 'style')),
      preserveOthers: noul(result.data, 'preserve_others').noul,
    }

    const meta = {
      provider: result.meta.provider,
      model: result.meta.model,
      latencyMs: result.meta.latencyMs,
      ...(result.meta.usage ? { usage: { ...result.meta.usage } } : {}),
    }

    if (
      decisions.intent.confidence < this.intentConfidenceThreshold ||
      decisions.intent.value === 'unknown'
    ) {
      return {
        status: 'needs_clarification',
        message: '这条指令的主要设计意图还不够明确，请把要修改的对象和动作说得更具体。',
        operations: [],
        decisions,
        meta,
      }
    }

    if (
      decisions.intent.value === 'move_object' ||
      decisions.intent.value === 'rotate_object'
    ) {
      return {
        status: 'unsupported',
        message: '当前自然语言链路暂不猜测厘米级位移或旋转角度；请先使用 3D 操作，后续会接结构化数值提取。',
        operations: [],
        decisions,
        meta,
      }
    }

    const targetId =
      decisions.target.value !== 'none' && decisions.target.value !== 'current_room'
        ? decisions.target.value
        : undefined
    const target = currentObject(request, targetId)
    const targetRequired = [
      'replace_object',
      'remove_object',
      'lock_object',
      'unlock_object',
    ].includes(decisions.intent.value)

    if (
      targetRequired &&
      (!target || decisions.target.confidence < this.targetConfidenceThreshold)
    ) {
      return {
        status: 'needs_clarification',
        message: '我还不能确定你要修改哪一个现有家具，请明确说出对象。',
        operations: [],
        decisions,
        meta,
      }
    }

    const operations: DesignOperation[] = []
    const roomScope = {
      type: 'room',
      roomId: request.context.activeRoom.id,
    } as const
    const opId = (suffix: string) => request.requestId + '-' + suffix

    if (decisions.intent.value === 'initial_layout') {
      const existingCategories = new Set(
        request.context.objects.map((object) => object.category),
      )
      const styleRequirement =
        decisions.style.value === 'warm_modern' ? { style: 'warm-modern' } : {}

      if (!existingCategories.has('sofa')) {
        operations.push({
          id: opId('add-sofa'),
          type: 'add_object',
          source: 'ai',
          scope: roomScope,
          category: 'sofa',
          requirements: { ...styleRequirement, minSeats: 3, maxWidth: 2.3 },
        })
      }

      if (!existingCategories.has('coffee_table')) {
        operations.push({
          id: opId('add-coffee-table'),
          type: 'add_object',
          source: 'ai',
          scope: roomScope,
          category: 'coffee_table',
          requirements: { ...styleRequirement, maxWidth: 1.3 },
        })
      }

      if (!existingCategories.has('plant')) {
        operations.push({
          id: opId('add-plant'),
          type: 'add_object',
          source: 'ai',
          scope: roomScope,
          category: 'plant',
          requirements: {
            styleTags:
              decisions.style.value === 'warm_modern'
                ? ['warm-modern', 'greenery']
                : ['greenery'],
          },
        })
      }
    } else if (decisions.intent.value === 'add_object') {
      if (decisions.category.value === 'none') {
        return {
          status: 'needs_clarification',
          message: '我知道你想新增家具，但还不能确定要新增哪一种。',
          operations: [],
          decisions,
          meta,
        }
      }

      operations.push({
        id: opId('add-' + decisions.category.value),
        type: 'add_object',
        source: 'ai',
        scope: roomScope,
        category: decisions.category.value,
        requirements: objectRequirements(decisions, undefined),
      })
    } else if (decisions.intent.value === 'replace_object' && target) {
      operations.push({
        id: opId('replace-' + target.id),
        type: 'replace_object',
        source: 'ai',
        scope: { type: 'object', objectId: target.id },
        objectId: target.id,
        requirements: objectRequirements(decisions, target),
      })
    } else if (decisions.intent.value === 'remove_object' && target) {
      operations.push({
        id: opId('remove-' + target.id),
        type: 'remove_object',
        source: 'ai',
        scope: { type: 'object', objectId: target.id },
        objectId: target.id,
      })
    } else if (decisions.intent.value === 'lock_object' && target) {
      if (target.locked) {
        return {
          status: 'no_change',
          message: target.label + ' 已经处于锁定状态。',
          operations: [],
          decisions,
          meta,
        }
      }

      operations.push({
        id: opId('lock-' + target.id),
        type: 'lock',
        source: 'ai',
        scope: { type: 'object', objectId: target.id },
        targetId: target.id,
      })
    } else if (decisions.intent.value === 'unlock_object' && target) {
      if (!target.locked) {
        return {
          status: 'no_change',
          message: target.label + ' 当前没有被锁定。',
          operations: [],
          decisions,
          meta,
        }
      }

      operations.push({
        id: opId('unlock-' + target.id),
        type: 'unlock',
        source: 'ai',
        scope: { type: 'object', objectId: target.id },
        targetId: target.id,
      })
    } else if (decisions.intent.value === 'style_change') {
      if (
        decisions.style.value === 'unspecified' ||
        decisions.style.value === 'keep'
      ) {
        return {
          status: 'needs_clarification',
          message: '我知道你想调整整体风格，但还需要更明确的风格描述。',
          operations: [],
          decisions,
          meta,
        }
      }

      operations.push({
        id: opId('style-' + request.context.activeRoom.id),
        type: 'set_style_intent',
        source: 'ai',
        scope: roomScope,
        targetId: request.context.activeRoom.id,
        style: { style: decisions.style.value },
      })
    }

    if (
      decisions.preserveOthers >= 0.55 &&
      decisions.intent.value !== 'initial_layout'
    ) {
      operations.push(...preserveOperations(request, target?.id))
    }

    if (operations.length === 0) {
      return {
        status: 'no_change',
        message: '这条指令没有产生需要执行的设计修改。',
        operations,
        decisions,
        meta,
      }
    }

    return {
      status: 'ready',
      message: '已将自然语言转换为 ' + operations.length + ' 个可验证的 DesignOperation。',
      operations,
      decisions,
      meta,
    }
  }
}
