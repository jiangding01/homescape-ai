import { describe, expect, it } from 'vitest'
import { sharedWallRoomIds } from './floorplan-opening-match.mjs'

// 100 px/m，墙厚 0.24 m（24 px）。客厅与卧室隔一道竖墙，卫生间在客厅下方、与卧室不相邻。
const draft = {
  calibration: { startPx: [0, 0], endPx: [100, 0], realDistanceMeters: 1 },
  assumptions: { wallThicknessMeters: 0.24 },
  rooms: [
    {
      id: 'living',
      boundaryPx: [
        [0, 0],
        [400, 0],
        [400, 300],
        [0, 300],
      ],
    },
    {
      id: 'bedroom',
      boundaryPx: [
        [424, 0],
        [724, 0],
        [724, 300],
        [424, 300],
      ],
    },
    {
      id: 'bath',
      boundaryPx: [
        [0, 324],
        [200, 324],
        [200, 524],
        [0, 524],
      ],
    },
  ],
}

describe('sharedWallRoomIds', () => {
  it('隔墙上的门：墙另一侧的房间也算所在房间', () => {
    // 客厅右边（edge 1，自上而下）上的门
    const door = { roomId: 'living', edgeIndex: 1, offsetPx: 100, widthPx: 90 }
    expect(sharedWallRoomIds(draft, door)).toEqual(['bedroom'])
  })

  it('从另一侧挂载时对称成立', () => {
    // 卧室左边（edge 3，自下而上）
    const door = { roomId: 'bedroom', edgeIndex: 3, offsetPx: 110, widthPx: 90 }
    expect(sharedWallRoomIds(draft, door)).toEqual(['living'])
  })

  it('外墙窗没有相邻房间；开口不在对侧房间的边范围内也不算', () => {
    const window = { roomId: 'living', edgeIndex: 0, offsetPx: 100, widthPx: 100 }
    expect(sharedWallRoomIds(draft, window)).toEqual([])

    // 客厅下边（edge 2，自右向左），右段开口对着的是墙外，不是卫生间
    const outside = { roomId: 'living', edgeIndex: 2, offsetPx: 20, widthPx: 80 }
    expect(sharedWallRoomIds(draft, outside)).toEqual([])

    const intoBath = { roomId: 'living', edgeIndex: 2, offsetPx: 260, widthPx: 80 }
    expect(sharedWallRoomIds(draft, intoBath)).toEqual(['bath'])
  })

  it('距离超过墙厚 + 余量的平行边不算同一道墙', () => {
    const far = {
      ...draft,
      rooms: draft.rooms.map((room) =>
        room.id === 'bedroom'
          ? { ...room, boundaryPx: room.boundaryPx.map(([x, y]) => [x + 20, y]) }
          : room,
      ),
    }
    const door = { roomId: 'living', edgeIndex: 1, offsetPx: 100, widthPx: 90 }
    expect(sharedWallRoomIds(far, door)).toEqual([])
  })
})
