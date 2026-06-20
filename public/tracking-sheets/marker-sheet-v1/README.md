# Marker Sheet v1

This folder defines the export-ready assets for the QRcode-AR multi-marker tracking sheet.

The current app can keep using the existing single-image MindAR target as a fallback. This sheet is the next architecture: one printed sheet with multiple local marker targets around the masterplan area.

## Why this exists

The old approach tracks the whole printed masterplan as one large image target. That works only when the camera sees enough of the complete sheet. With local markers, each marker becomes its own MindAR target. If the phone sees only one marker, the app can still estimate that marker pose and reconstruct the global sheet pose from the manifest.

## Runtime model

1. Export each marker image from `markers/*.png`.
2. Compile the marker images into one multi-target `.mind` file.
3. Keep `targetIndex` in the MindAR compiler order aligned with `tracking-sheet-manifest.json`.
4. When MindAR detects marker N, map `targetIndex` back to the marker id.
5. Use the marker transform plus the manifest's normalized position, size, and rotation to compute the sheet transform.
6. Attach the AR model to the reconstructed sheet pose.
7. If multiple markers are visible, average or fuse the candidate sheet poses for stability.

Start with MindAR `maxTrack` at 1 or 2. The system still benefits from many targets because the visible marker can change as the camera moves, without requiring all targets to track at once.

## Coordinate system

Manifest marker coordinates are normalized from the sheet top-left:

- `x`, `y`: top-left of the marker slot before rotation.
- `width`, `height`: normalized against sheet width and sheet height.
- `rotationDeg`: printed rotation of the marker asset around its own center.

For AR placement, convert marker centers to sheet-centered millimeters:

```text
markerCenterX = marker.x + marker.width / 2
markerCenterY = marker.y + marker.height / 2
xMm = (markerCenterX - 0.5) * sheetWidthMm
yMm = (0.5 - markerCenterY) * sheetHeightMm
```

The AR sheet coordinate system uses x to the right, y up, and z normal to the sheet.

## Figma and JSON

Figma is the visual source of truth for presentation and export. The JSON manifest is the technical source of truth for runtime reconstruction. Figma node names mirror the manifest:

- `sheet:A0|orientation:landscape`
- `marker:M00_TopLeft|targetIndex:0`
- `content:masterplan`
- `export:tracking-sheet-v1`

Use the Figma file or the SVG assets here to export printable sheet previews. Do not replace the active runtime target until the multi-target `.mind` file and marker-to-sheet pose conversion are implemented.

## Generated files

- `tracking-sheet-manifest.json`: normalized layout and marker metadata.
- `markers/*.svg`: vector marker targets for Figma/plugin export and source control.
- `markers/*.png`: raster marker targets ready for MindAR compilation.
- `layout-preview-a0.svg/png`, `layout-preview-a1.svg/png`, `layout-preview-a3.svg/png`: sheet previews.
