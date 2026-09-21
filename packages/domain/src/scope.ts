export type DesignScope =
  | { type: 'project'; projectId: string }
  | { type: 'floor'; floorId: string }
  | { type: 'room'; roomId: string }
  | { type: 'zone'; zoneId: string }
  | { type: 'object'; objectId: string }
