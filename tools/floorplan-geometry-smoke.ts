import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import {
  OrthogonalGeometryReconstructor,
  parseFloorPlanGeometryObservation,
} from '@homescape/floorplan-extractor'

interface Expectation {
  file: string
  rooms: number
  openings: number
  boundaryPoints?: number
}

const cases: readonly Expectation[] = [
  {
    file: 'plan-a.observation.json',
    rooms: 5,
    openings: 5,
  },
  {
    file: 'plan-b.observation.json',
    rooms: 5,
    openings: 6,
  },
  {
    file: 'l-shape.observation.json',
    rooms: 1,
    openings: 0,
    boundaryPoints: 6,
  },
]

async function main() {
  const root = resolve(
    process.cwd(),
    'tools/fixtures/floorplan-geometry',
  )
  const reconstructor = new OrthogonalGeometryReconstructor()

  for (const testCase of cases) {
    const raw = JSON.parse(
      await readFile(resolve(root, testCase.file), 'utf8'),
    )
    const observation = parseFloorPlanGeometryObservation(raw)
    const result = reconstructor.reconstruct(observation)

    if ((result.warnings?.length ?? 0) !== 0) {
      throw new Error(
        testCase.file +
          ' 产生非预期 Warning：' +
          (result.warnings ?? []).join('；'),
      )
    }

    if (result.draft.rooms.length !== testCase.rooms) {
      throw new Error(
        testCase.file +
          ' Room 数不匹配：' +
          result.draft.rooms.length +
          ' != ' +
          testCase.rooms,
      )
    }

    if (result.draft.openings.length !== testCase.openings) {
      throw new Error(
        testCase.file +
          ' Opening 数不匹配：' +
          result.draft.openings.length +
          ' != ' +
          testCase.openings,
      )
    }

    if (testCase.boundaryPoints !== undefined) {
      const room = result.draft.rooms[0]

      if (!room || room.boundaryPx.length !== testCase.boundaryPoints) {
        throw new Error(
          testCase.file +
            ' Boundary 点数不匹配：' +
            (room?.boundaryPx.length ?? 0) +
            ' != ' +
            testCase.boundaryPoints,
        )
      }
    }
  }

  process.stderr.write(
    'Floor Plan Geometry Baseline smoke check passed · ' +
      cases.length +
      ' cases\n',
  )
}

main().catch((error) => {
  process.stderr.write(
    (error instanceof Error ? error.stack ?? error.message : String(error)) +
      '\n',
  )
  process.exitCode = 1
})
