# Marker Sheet A0 v1

This is the active multi-marker tracking sheet for QRcode-AR.

- Format: A0 landscape, 1189 x 841 mm
- Runtime target file: `marker-sheet-a0-v1.mind`
- Manifest: `tracking-sheet-manifest.json`
- Target order: `markers/*.png` sorted by `targetIndex`

The full sheet is not a single image target. Each marker is compiled as an
individual MindAR target, and the app reconstructs the full A0 sheet pose from
the detected marker's known sheet position.
