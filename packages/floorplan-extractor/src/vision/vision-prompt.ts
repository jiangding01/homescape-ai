/**
 * Prompt 是可复现性的一部分：改动任何措辞都必须升级版本号，
 * 回放旧响应时请求指纹会因 Prompt 哈希变化而拒绝。
 */
export const VISION_PROMPT_VERSION = 'floorplan-vision-prompt-v3'

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
    '- List vertices in order around the room, without repeating the first vertex at the end. Where walls are axis-aligned, keep edges exactly horizontal or vertical. Where a wall or glazing is drawn at an angle (for example the sides of a bay window or bay balcony), follow the angle with its own edge instead of squaring it off.',
    '- A corridor or entrance area (for example 过道, 走廊, 玄关) that opens into the living / dining area without a door belongs to that living / dining room: include it in the living room polygon and do not return it as a separate room, even when the plan prints its own name or area for it. Mention the merged names in notes. Merge a living room and dining room into one "living" room when no wall separates them.',
    '- Include balconies, bathrooms, kitchens and storage rooms. Exclude the outside area, shafts and furniture.',
    '- label is the room name printed on the plan, copied as written (for example 客厅, 主卧, 卫生间); use an empty string if none is printed.',
    '',
    'Openings',
    '- Report every door, window and doorless opening. Almost every room has at least one door or doorless opening, and rooms on the exterior usually also have windows; reporting only the most obvious ones is the most common mistake.',
    '- Work room by room: for each room you returned, walk along all of its walls and report every opening you find before moving to the next room. An opening in a wall between two rooms is reported once. Do not report the boundary between areas you merged into one room as an opening.',
    '- How they are drawn:',
    '  - Hinged door: a gap in the wall with a door leaf line and a quarter-circle swing arc (two leaves and two arcs for a double door). Doors can be small on the image and the arc is often a faint thin line, partly hidden by furniture, flooring or a watermark; look for every arc, including bathroom, kitchen and balcony doors. If a leaf or arc is visible, report a door, not a doorless opening.',
    '  - Sliding door: a gap in the wall with two thin overlapping or offset panels drawn inside the wall thickness.',
    '  - Window: a section of exterior wall drawn as two to four thin parallel lines instead of a solid wall. Bay windows and the glazing around balconies count as windows: report each straight glazed segment separately. A bay window usually has three segments, a front segment and two short angled side segments; report all three, each with its own start and end.',
    '  - Doorless opening: a gap in a wall with no door symbol, for example between a corridor and a room, or a wall opening into a kitchen.',
    '- start and end are the two jamb positions: the ends of the gap measured along the wall, at the wall centre line. The width is the clear gap in the wall, not the length of the swing arc or of furniture next to it.',
    '- swing: left / right / double for hinged doors as drawn, sliding for sliding doors, none for windows and doorless openings, unknown if unclear.',
    '- If you are unsure whether something is a door or window, still report it with a lower confidence rather than leaving it out.',
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
