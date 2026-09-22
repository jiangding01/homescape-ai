# ADR 0016: Keep Raster Decoding Behind a Node-only Subpath

- Status: Accepted
- Date: 2026-09-22

## Context

PR #16 needs PNG / JPEG decoding before the deterministic Raster Geometry Detector can operate.

The existing `@homescape/floorplan-extractor` main entry is also imported by the Web Workbench. A native image dependency must not be accidentally pulled into the browser dependency graph.

## Decision

Keep the platform-neutral contracts and detector in the main entry:

~~~text
@homescape/floorplan-extractor
  RasterImage
  RasterImageDecoder
  RasterGeometryDetector
  GeometryFloorPlanExtractor
~~~

Expose the concrete Sharp decoder only through:

~~~text
@homescape/floorplan-extractor/node
~~~

The Node decoder is responsible only for raster decoding and normalization:

~~~text
encoded PNG / JPEG
→ EXIF orientation
→ sRGB
→ alpha composite on white
→ luminance
~~~

It does not own wall detection, topology reconstruction, Room semantics, or Benchmark logic.

## Dependency policy

Sharp is pinned to an exact version because this repository currently has no committed pnpm lockfile.

pnpm 10 blocks dependency lifecycle scripts by default, while Sharp requires its trusted install step for the native binding. The root pnpm configuration therefore allow-lists only `sharp` through `onlyBuiltDependencies`.

This is narrower than globally enabling dependency scripts.

## Consequences

Benefits:

- Web code does not import the Node native decoder.
- Raster detection remains testable with any decoder implementation.
- A future browser / WASM decoder can implement the same interface.
- Image decode security limits are centralized.
- Native dependency execution is explicitly allow-listed.

Costs:

- Node callers must use the `./node` package subpath.
- CI must install the Sharp native package.
- Runtime support is currently limited to PNG / JPEG for this baseline.

## Non-goals

This ADR does not select the final CV algorithm, OCR provider, VLM, PDF rasterizer, or production image service.
