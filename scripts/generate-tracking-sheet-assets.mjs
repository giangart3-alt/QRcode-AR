import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const outputRoot = path.join(
  projectRoot,
  "public",
  "tracking-sheets",
  "marker-sheet-v1",
);
const markersRoot = path.join(outputRoot, "markers");

const sheetId = "marker-sheet-v1";
const version = "1.0.0";
const markerSize = { width: 0.071, height: 0.1 };

const formats = {
  A0: { widthMm: 1189, heightMm: 841 },
  A1: { widthMm: 841, heightMm: 594 },
  A2: { widthMm: 594, heightMm: 420 },
  A3: { widthMm: 420, heightMm: 297 },
  A4: { widthMm: 297, heightMm: 210 },
};

const contentArea = {
  x: 0.18,
  y: 0.17,
  width: 0.64,
  height: 0.66,
};

const markers = [
  {
    id: "M00_TopLeft",
    targetIndex: 0,
    asset: "markers/M00_TopLeft.svg",
    x: 0.05,
    y: 0.06,
    rotationDeg: 0,
    role: "corner",
    pattern: "asymmetric-nested-square",
  },
  {
    id: "M01_Top",
    targetIndex: 1,
    asset: "markers/M01_Top.svg",
    x: 0.4645,
    y: 0.052,
    rotationDeg: 0,
    role: "edge",
    pattern: "offset-diamond",
  },
  {
    id: "M02_TopRight",
    targetIndex: 2,
    asset: "markers/M02_TopRight.svg",
    x: 0.879,
    y: 0.06,
    rotationDeg: 0,
    role: "corner",
    pattern: "diagonal-split",
  },
  {
    id: "M03_Left",
    targetIndex: 3,
    asset: "markers/M03_Left.svg",
    x: 0.05,
    y: 0.45,
    rotationDeg: -90,
    role: "edge",
    pattern: "bullseye-notch",
  },
  {
    id: "M04_Right",
    targetIndex: 4,
    asset: "markers/M04_Right.svg",
    x: 0.879,
    y: 0.45,
    rotationDeg: 90,
    role: "edge",
    pattern: "blocky-modules",
  },
  {
    id: "M05_BottomLeft",
    targetIndex: 5,
    asset: "markers/M05_BottomLeft.svg",
    x: 0.05,
    y: 0.84,
    rotationDeg: 180,
    role: "corner",
    pattern: "crosshair-corners",
  },
  {
    id: "M06_Bottom",
    targetIndex: 6,
    asset: "markers/M06_Bottom.svg",
    x: 0.4645,
    y: 0.848,
    rotationDeg: 180,
    role: "edge",
    pattern: "staircase",
  },
  {
    id: "M07_BottomRight",
    targetIndex: 7,
    asset: "markers/M07_BottomRight.svg",
    x: 0.879,
    y: 0.84,
    rotationDeg: 180,
    role: "corner",
    pattern: "quadrant-cutout",
  },
].map((marker) => ({
  ...marker,
  width: markerSize.width,
  height: markerSize.height,
}));

function svgDoc(body, attrs = "") {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" ${attrs}>
  <rect width="512" height="512" fill="#fff"/>
${body}
</svg>
`;
}

function markerSvg(id) {
  const common = `
  <rect x="24" y="24" width="464" height="464" fill="none" stroke="#000" stroke-width="32"/>
  <rect x="54" y="54" width="404" height="404" fill="none" stroke="#000" stroke-width="12"/>`;

  const bodies = {
    M00_TopLeft: `${common}
  <rect x="92" y="92" width="116" height="44" fill="#000"/>
  <rect x="92" y="92" width="44" height="178" fill="#000"/>
  <rect x="190" y="170" width="120" height="32" fill="#000"/>
  <rect x="170" y="242" width="62" height="62" fill="#000"/>
  <rect x="286" y="246" width="104" height="36" fill="#000"/>
  <rect x="346" y="118" width="42" height="128" fill="#000"/>
  <rect x="284" y="334" width="122" height="42" fill="#000"/>
  <rect x="118" y="366" width="62" height="62" fill="#000"/>`,
    M01_Top: `
  <polygon points="256,30 482,256 256,482 30,256" fill="#000"/>
  <polygon points="256,88 424,256 256,424 88,256" fill="#fff"/>
  <polygon points="256,138 374,256 256,374 138,256" fill="#000"/>
  <rect x="196" y="94" width="62" height="62" fill="#000"/>
  <rect x="322" y="208" width="74" height="42" fill="#000"/>
  <rect x="122" y="274" width="88" height="38" fill="#000"/>
  <rect x="246" y="330" width="46" height="86" fill="#000"/>
  <circle cx="314" cy="170" r="26" fill="#fff"/>
  <rect x="222" y="226" width="68" height="68" fill="#fff"/>`,
    M02_TopRight: `${common}
  <polygon points="76,92 420,92 92,420 76,420" fill="#000"/>
  <polygon points="420,138 420,244 244,420 138,420" fill="#000"/>
  <rect x="110" y="122" width="62" height="62" fill="#fff"/>
  <rect x="204" y="124" width="40" height="96" fill="#fff"/>
  <rect x="300" y="130" width="78" height="40" fill="#000"/>
  <rect x="284" y="254" width="98" height="42" fill="#000"/>
  <rect x="128" y="298" width="46" height="84" fill="#fff"/>
  <rect x="332" y="344" width="58" height="58" fill="#000"/>`,
    M03_Left: `
  <circle cx="256" cy="256" r="214" fill="#000"/>
  <circle cx="256" cy="256" r="164" fill="#fff"/>
  <circle cx="256" cy="256" r="112" fill="#000"/>
  <circle cx="256" cy="256" r="58" fill="#fff"/>
  <rect x="254" y="42" width="80" height="140" fill="#fff"/>
  <rect x="332" y="112" width="104" height="40" fill="#fff"/>
  <rect x="88" y="328" width="124" height="40" fill="#fff"/>
  <rect x="296" y="300" width="44" height="128" fill="#000"/>
  <rect x="156" y="126" width="50" height="50" fill="#000"/>`,
    M04_Right: `${common}
  <rect x="88" y="90" width="88" height="88" fill="#000"/>
  <rect x="214" y="90" width="42" height="126" fill="#000"/>
  <rect x="310" y="92" width="110" height="54" fill="#000"/>
  <rect x="88" y="220" width="54" height="122" fill="#000"/>
  <rect x="188" y="250" width="88" height="88" fill="#000"/>
  <rect x="326" y="214" width="44" height="158" fill="#000"/>
  <rect x="104" y="390" width="138" height="36" fill="#000"/>
  <rect x="288" y="404" width="52" height="52" fill="#000"/>
  <rect x="386" y="328" width="42" height="92" fill="#000"/>`,
    M05_BottomLeft: `${common}
  <rect x="226" y="88" width="60" height="336" fill="#000"/>
  <rect x="88" y="226" width="336" height="60" fill="#000"/>
  <rect x="92" y="92" width="112" height="32" fill="#000"/>
  <rect x="92" y="92" width="32" height="112" fill="#000"/>
  <rect x="318" y="82" width="104" height="40" fill="#000"/>
  <rect x="388" y="82" width="36" height="122" fill="#000"/>
  <rect x="90" y="356" width="42" height="72" fill="#000"/>
  <rect x="90" y="390" width="130" height="38" fill="#000"/>
  <rect x="350" y="350" width="72" height="72" fill="#000"/>
  <rect x="168" y="154" width="38" height="38" fill="#fff"/>
  <rect x="314" y="296" width="46" height="46" fill="#fff"/>`,
    M06_Bottom: `${common}
  <rect x="94" y="370" width="320" height="42" fill="#000"/>
  <rect x="94" y="318" width="270" height="42" fill="#000"/>
  <rect x="94" y="266" width="218" height="42" fill="#000"/>
  <rect x="94" y="214" width="166" height="42" fill="#000"/>
  <rect x="94" y="162" width="114" height="42" fill="#000"/>
  <rect x="94" y="110" width="62" height="42" fill="#000"/>
  <rect x="300" y="102" width="102" height="64" fill="#000"/>
  <rect x="342" y="202" width="56" height="96" fill="#000"/>
  <rect x="220" y="116" width="46" height="46" fill="#000"/>
  <rect x="154" y="330" width="42" height="42" fill="#fff"/>`,
    M07_BottomRight: `${common}
  <rect x="92" y="92" width="144" height="144" fill="#000"/>
  <rect x="278" y="92" width="142" height="142" fill="#000"/>
  <rect x="92" y="278" width="142" height="142" fill="#000"/>
  <rect x="278" y="278" width="142" height="142" fill="#000"/>
  <rect x="142" y="142" width="48" height="48" fill="#fff"/>
  <rect x="320" y="118" width="72" height="34" fill="#fff"/>
  <rect x="336" y="152" width="34" height="54" fill="#fff"/>
  <rect x="120" y="326" width="88" height="36" fill="#fff"/>
  <rect x="320" y="318" width="52" height="52" fill="#fff"/>
  <rect x="370" y="370" width="28" height="28" fill="#fff"/>
  <rect x="232" y="232" width="48" height="48" fill="#000"/>`,
  };

  return svgDoc(bodies[id]);
}

function layoutPreviewSvg(formatName) {
  const format = formats[formatName];
  const width = format.widthMm;
  const height = format.heightMm;
  const safe = 24;
  const cx = (contentArea.x + contentArea.width / 2) * width;
  const cy = (contentArea.y + contentArea.height / 2) * height;
  const gridLines = Array.from({ length: 7 }, (_, index) => {
    const x = (contentArea.x + ((index + 1) * contentArea.width) / 8) * width;
    const y = (contentArea.y + ((index + 1) * contentArea.height) / 8) * height;
    return `  <line x1="${x.toFixed(2)}" y1="${contentArea.y * height}" x2="${x.toFixed(2)}" y2="${(contentArea.y + contentArea.height) * height}" stroke="#d8d8d8" stroke-width="0.7"/>
  <line x1="${contentArea.x * width}" y1="${y.toFixed(2)}" x2="${(contentArea.x + contentArea.width) * width}" y2="${y.toFixed(2)}" stroke="#d8d8d8" stroke-width="0.7"/>`;
  }).join("\n");

  const markerImages = markers
    .map((marker) => {
      const x = marker.x * width;
      const y = marker.y * height;
      const w = marker.width * width;
      const h = marker.height * height;
      const centerX = x + w / 2;
      const centerY = y + h / 2;
      return `  <g transform="rotate(${marker.rotationDeg} ${centerX.toFixed(2)} ${centerY.toFixed(2)})">
    <svg x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" viewBox="0 0 512 512">
${markerSvg(marker.id)
  .replace(/^<svg[^>]*>\n?/, "")
  .replace(/\n?<\/svg>\n?$/, "")
  .split("\n")
  .map((line) => `      ${line}`)
  .join("\n")}
    </svg>
  </g>`;
    })
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#fff"/>
  <rect x="${safe}" y="${safe}" width="${width - safe * 2}" height="${height - safe * 2}" fill="none" stroke="#000" stroke-width="1.2"/>
  <rect x="${(contentArea.x * width).toFixed(2)}" y="${(contentArea.y * height).toFixed(2)}" width="${(contentArea.width * width).toFixed(2)}" height="${(contentArea.height * height).toFixed(2)}" fill="#f7f7f7" stroke="#000" stroke-width="1.4"/>
${gridLines}
  <line x1="${(contentArea.x * width).toFixed(2)}" y1="${cy.toFixed(2)}" x2="${((contentArea.x + contentArea.width) * width).toFixed(2)}" y2="${cy.toFixed(2)}" stroke="#000" stroke-width="1"/>
  <line x1="${cx.toFixed(2)}" y1="${(contentArea.y * height).toFixed(2)}" x2="${cx.toFixed(2)}" y2="${((contentArea.y + contentArea.height) * height).toFixed(2)}" stroke="#000" stroke-width="1"/>
${markerImages}
</svg>
`;
}

function manifest() {
  return {
    sheetId,
    version,
    defaultFormat: "A0",
    orientation: "landscape",
    coordinateSystem: {
      origin: "sheet-center",
      xAxis: "sheet-right",
      yAxis: "sheet-up",
      zAxis: "sheet-normal",
      units: "normalized-and-mm",
      normalizedCoordinates: {
        origin: "sheet-top-left",
        xAxis: "sheet-right",
        yAxis: "sheet-down",
        range: "0..1",
        markerXy: "top-left of printed marker slot before rotation",
        markerWidthHeight: "normalized against sheet width and sheet height",
      },
      arConversion: {
        xMm: "(markerCenterXNormalized - 0.5) * sheetWidthMm",
        yMm: "(0.5 - markerCenterYNormalized) * sheetHeightMm",
        markerCenterXNormalized: "marker.x + marker.width / 2",
        markerCenterYNormalized: "marker.y + marker.height / 2",
      },
    },
    formats,
    print: {
      safeMarginNormalized: { x: 0.035, y: 0.045 },
      colorMode: "black-and-white",
      notes: [
        "Export marker PNGs individually and compile them into one multi-target .mind file.",
        "Keep the existing single-image target available until the multi-marker runtime is implemented.",
      ],
    },
    contentArea: {
      ...contentArea,
      role: "masterplan-placeholder",
      trackingRequired: false,
    },
    markers,
  };
}

function readme() {
  return `# Marker Sheet v1

This folder defines the export-ready assets for the QRcode-AR multi-marker tracking sheet.

The current app can keep using the existing single-image MindAR target as a fallback. This sheet is the next architecture: one printed sheet with multiple local marker targets around the masterplan area.

## Why this exists

The old approach tracks the whole printed masterplan as one large image target. That works only when the camera sees enough of the complete sheet. With local markers, each marker becomes its own MindAR target. If the phone sees only one marker, the app can still estimate that marker pose and reconstruct the global sheet pose from the manifest.

## Runtime model

1. Export each marker image from \`markers/*.png\`.
2. Compile the marker images into one multi-target \`.mind\` file.
3. Keep \`targetIndex\` in the MindAR compiler order aligned with \`tracking-sheet-manifest.json\`.
4. When MindAR detects marker N, map \`targetIndex\` back to the marker id.
5. Use the marker transform plus the manifest's normalized position, size, and rotation to compute the sheet transform.
6. Attach the AR model to the reconstructed sheet pose.
7. If multiple markers are visible, average or fuse the candidate sheet poses for stability.

Start with MindAR \`maxTrack\` at 1 or 2. The system still benefits from many targets because the visible marker can change as the camera moves, without requiring all targets to track at once.

## Coordinate system

Manifest marker coordinates are normalized from the sheet top-left:

- \`x\`, \`y\`: top-left of the marker slot before rotation.
- \`width\`, \`height\`: normalized against sheet width and sheet height.
- \`rotationDeg\`: printed rotation of the marker asset around its own center.

For AR placement, convert marker centers to sheet-centered millimeters:

\`\`\`text
markerCenterX = marker.x + marker.width / 2
markerCenterY = marker.y + marker.height / 2
xMm = (markerCenterX - 0.5) * sheetWidthMm
yMm = (0.5 - markerCenterY) * sheetHeightMm
\`\`\`

The AR sheet coordinate system uses x to the right, y up, and z normal to the sheet.

## Figma and JSON

Figma is the visual source of truth for presentation and export. The JSON manifest is the technical source of truth for runtime reconstruction. Figma node names mirror the manifest:

- \`sheet:A0|orientation:landscape\`
- \`marker:M00_TopLeft|targetIndex:0\`
- \`content:masterplan\`
- \`export:tracking-sheet-v1\`

Use the Figma file or the SVG assets here to export printable sheet previews. Do not replace the active runtime target until the multi-target \`.mind\` file and marker-to-sheet pose conversion are implemented.

## Generated files

- \`tracking-sheet-manifest.json\`: normalized layout and marker metadata.
- \`markers/*.svg\`: vector marker targets for Figma/plugin export and source control.
- \`markers/*.png\`: raster marker targets ready for MindAR compilation.
- \`layout-preview-a0.svg/png\`, \`layout-preview-a1.svg/png\`, \`layout-preview-a3.svg/png\`: sheet previews.
`;
}

async function writePngFromSvg(svg, filePath, width) {
  await sharp(Buffer.from(svg)).resize({ width }).png().toFile(filePath);
}

async function main() {
  await mkdir(markersRoot, { recursive: true });

  for (const marker of markers) {
    const svg = markerSvg(marker.id);
    const base = path.join(markersRoot, marker.id);
    await writeFile(`${base}.svg`, svg, "utf8");
    await writePngFromSvg(svg, `${base}.png`, 1024);
  }

  for (const formatName of ["A0", "A1", "A3"]) {
    const svg = layoutPreviewSvg(formatName);
    const base = path.join(outputRoot, `layout-preview-${formatName.toLowerCase()}`);
    await writeFile(`${base}.svg`, svg, "utf8");
    await writePngFromSvg(svg, `${base}.png`, Math.round(formats[formatName].widthMm * 3));
  }

  await writeFile(
    path.join(outputRoot, "tracking-sheet-manifest.json"),
    `${JSON.stringify(manifest(), null, 2)}\n`,
    "utf8",
  );
  await writeFile(path.join(outputRoot, "README.md"), readme(), "utf8");

  return {
    outputRoot,
    markerCount: markers.length,
    previews: ["A0", "A1", "A3"],
  };
}

main()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
