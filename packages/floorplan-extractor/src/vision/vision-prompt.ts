/**
 * Prompt 是可复现性的一部分：改动任何措辞都必须升级版本号，
 * 回放旧响应时请求指纹会因 Prompt 哈希变化而拒绝。
 */
export const VISION_PROMPT_VERSION = 'floorplan-vision-prompt-v1'

export const VISION_SYSTEM_PROMPT = [
  'You read residential floor plan images and report what is drawn as structured data.',
  'Your output pre-fills an annotation tool; a human reviews every value afterwards,',
  'so report only what you can see. Never invent dimensions that are not printed on the plan.',
].join(' ')

export interface VisionPromptImage {
  widthPx: number
  heightPx: number
}

export function buildVisionUserPrompt(image: VisionPromptImage) {
  return [
    `The attached image is ${image.widthPx} x ${image.heightPx} pixels.`,
    'All coordinates you return are pixel coordinates in this image:',
    'origin at the top-left corner, x grows to the right, y grows downward.',
    '',
    'Rooms',
    '- Return one polygon per room, tracing the inner face of the surrounding walls (not the wall centre line and not the outer face).',
    '- List vertices in order around the room, without repeating the first vertex at the end. Where walls are axis-aligned, keep edges exactly horizontal or vertical.',
    '- A corridor that opens into the living / dining area without a door belongs to that living / dining room. Merge a living room and dining room into one "living" room when no wall separates them.',
    '- Include balconies, bathrooms, kitchens and storage rooms. Exclude the outside area, shafts and furniture.',
    '- label is the room name printed on the plan, copied as written (for example 客厅, 主卧, 卫生间); use an empty string if none is printed.',
    '',
    'Openings',
    '- For every door, window and doorless opening in a wall, return the segment along the wall where it sits: start and end are the two jamb positions.',
    '- swing: left / right / double for hinged doors as drawn, sliding for sliding doors, none for windows and doorless openings, unknown if unclear.',
    '',
    'Dimension lines',
    '- Read printed dimension annotations (usually millimetres, for example 3600). For each, return the printed text, its value in millimetres, whether it measures a horizontal or vertical distance, and the pixel positions of the two extension lines it spans.',
    '- Prefer long dimensions and overall chains, and give several per axis when the plan has them. Return an empty list if the plan has no dimensions.',
    '',
    'confidence is your probability (0 to 1) that the item is correct.',
    'If the image is not a floor plan, set isFloorPlan to false and return empty lists.',
    'Put anything a reviewer should know (unreadable text, cropped areas, unusual drawing style) in notes.',
  ].join('\n')
}
