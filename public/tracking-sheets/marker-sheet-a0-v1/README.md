# Marker Sheet A0 v1

This is the active multi-marker tracking sheet for QRcode-AR.

- Format: A0 landscape, 1189 x 841 mm
- Runtime target file: `marker-sheet-a0-v1.mind`
- Manifest: `tracking-sheet-manifest.json`
- Verification report: `tracking-sheet-report.json`
- Target order: `markers/*.png` sorted by `targetIndex`

The full sheet is not a single image target. Each marker is compiled as an
individual MindAR target, and the app reconstructs the full A0 sheet pose from
the detected marker's known sheet position.

Run `npm run generate:a0-marker-sheet` after editing this generator. The
command regenerates marker PNG/SVG files, manifest and preview assets, then
verifies the committed `.mind` file has the expected target count and
dimensions. Recompile `marker-sheet-a0-v1.mind` from the ordered marker PNGs whenever
marker artwork changes.
