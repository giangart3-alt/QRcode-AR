import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const sheetId = "marker-sheet-a0-v1";
const version = "1.0.0";
const outputRoot = path.join(projectRoot, "public", "tracking-sheets", sheetId);
const markersRoot = path.join(outputRoot, "markers");
const mindFilePath = path.join(outputRoot, `${sheetId}.mind`);

const sheet = {
  id: sheetId,
  format: "A0",
  orientation: "landscape",
  widthMm: 1189,
  heightMm: 841,
};

const markerSizeMm = 84.1;
const markerWidth = markerSizeMm / sheet.widthMm;
const markerHeight = markerSizeMm / sheet.heightMm;

const contentArea = {
  x: 214.02 / sheet.widthMm,
  y: 142.97 / sheet.heightMm,
  width: 760.96 / sheet.widthMm,
  height: 555.06 / sheet.heightMm,
};

const markers = [
  {
    id: "M00_TopLeft",
    targetIndex: 0,
    x: 59.45 / sheet.widthMm,
    y: 50.46 / sheet.heightMm,
    rotationDeg: 0,
    role: "top-left",
    pattern: "asymmetric-nested-square",
  },
  {
    id: "M01_Top",
    targetIndex: 1,
    x: 552.45 / sheet.widthMm,
    y: 50.46 / sheet.heightMm,
    rotationDeg: 0,
    role: "top-center",
    pattern: "offset-diamond",
  },
  {
    id: "M02_TopRight",
    targetIndex: 2,
    x: 1045.45 / sheet.widthMm,
    y: 50.46 / sheet.heightMm,
    rotationDeg: 0,
    role: "top-right",
    pattern: "diagonal-split",
  },
  {
    id: "M03_Left",
    targetIndex: 3,
    x: 59.45 / sheet.widthMm,
    y: 378.45 / sheet.heightMm,
    rotationDeg: -90,
    role: "left-center",
    pattern: "bullseye-notch",
  },
  {
    id: "M04_Right",
    targetIndex: 4,
    x: 1045.45 / sheet.widthMm,
    y: 378.45 / sheet.heightMm,
    rotationDeg: 90,
    role: "right-center",
    pattern: "blocky-modules",
  },
  {
    id: "M05_BottomLeft",
    targetIndex: 5,
    x: 59.45 / sheet.widthMm,
    y: 706.44 / sheet.heightMm,
    rotationDeg: 180,
    role: "bottom-left",
    pattern: "crosshair-corners",
  },
  {
    id: "M06_Bottom",
    targetIndex: 6,
    x: 552.45 / sheet.widthMm,
    y: 706.44 / sheet.heightMm,
    rotationDeg: 180,
    role: "bottom-center",
    pattern: "staircase",
  },
  {
    id: "M07_BottomRight",
    targetIndex: 7,
    x: 1045.45 / sheet.widthMm,
    y: 706.44 / sheet.heightMm,
    rotationDeg: 180,
    role: "bottom-right",
    pattern: "quadrant-cutout",
  },
].map((marker) => ({
  ...marker,
  width: markerWidth,
  height: markerHeight,
  widthMm: markerSizeMm,
  heightMm: markerSizeMm,
  assetPng: `markers/${marker.id}.png`,
  assetSvg: `markers/${marker.id}.svg`,
}));

function fixed(value, places = 6) {
  return Number(value.toFixed(places));
}

function svgDoc(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
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

function layoutPreviewSvg() {
  const width = sheet.widthMm;
  const height = sheet.heightMm;
  const safe = {
    x: 41.615,
    y: 37.845,
    width: 1105.77,
    height: 765.31,
  };
  const content = {
    x: contentArea.x * width,
    y: contentArea.y * height,
    width: contentArea.width * width,
    height: contentArea.height * height,
  };
  const cx = content.x + content.width / 2;
  const cy = content.y + content.height / 2;
  const gridLines = Array.from({ length: 7 }, (_, index) => {
    const x = content.x + ((index + 1) * content.width) / 8;
    const y = content.y + ((index + 1) * content.height) / 8;
    return `  <line x1="${x.toFixed(2)}" y1="${content.y.toFixed(2)}" x2="${x.toFixed(2)}" y2="${(content.y + content.height).toFixed(2)}" stroke="#d8d8d8" stroke-width="0.7"/>
  <line x1="${content.x.toFixed(2)}" y1="${y.toFixed(2)}" x2="${(content.x + content.width).toFixed(2)}" y2="${y.toFixed(2)}" stroke="#d8d8d8" stroke-width="0.7"/>`;
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
  <rect x="${safe.x}" y="${safe.y}" width="${safe.width}" height="${safe.height}" fill="none" stroke="#000" stroke-width="1.2"/>
  <rect x="${content.x.toFixed(2)}" y="${content.y.toFixed(2)}" width="${content.width.toFixed(2)}" height="${content.height.toFixed(2)}" fill="#f7f7f7" stroke="#000" stroke-width="1.1"/>
${gridLines}
  <line x1="${content.x.toFixed(2)}" y1="${cy.toFixed(2)}" x2="${(content.x + content.width).toFixed(2)}" y2="${cy.toFixed(2)}" stroke="#000" stroke-width="0.9"/>
  <line x1="${cx.toFixed(2)}" y1="${content.y.toFixed(2)}" x2="${cx.toFixed(2)}" y2="${(content.y + content.height).toFixed(2)}" stroke="#000" stroke-width="0.9"/>
${markerImages}
</svg>
`;
}

function manifest() {
  return {
    sheetId,
    version,
    format: sheet.format,
    orientation: sheet.orientation,
    imageTargetMode: "multi-marker-a0",
    mindUrl: `${sheetId}.mind`,
    previewPng: "layout-preview-a0.png",
    previewSvg: "layout-preview-a0.svg",
    maxTrack: 1,
    physicalSize: {
      widthMm: sheet.widthMm,
      heightMm: sheet.heightMm,
    },
    coordinateSystem: {
      origin: "sheet-center",
      xAxis: "right",
      yAxis: "up",
      zAxis: "sheet-normal",
      layoutCoordinates: "normalized-top-left",
    },
    contentArea: {
      x: fixed(contentArea.x),
      y: fixed(contentArea.y),
      width: fixed(contentArea.width),
      height: fixed(contentArea.height),
    },
    markers: markers.map((marker) => ({
      id: marker.id,
      targetIndex: marker.targetIndex,
      assetPng: marker.assetPng,
      assetSvg: marker.assetSvg,
      x: fixed(marker.x),
      y: fixed(marker.y),
      width: fixed(marker.width),
      height: fixed(marker.height),
      widthMm: marker.widthMm,
      heightMm: marker.heightMm,
      rotationDeg: marker.rotationDeg,
      role: marker.role,
      pattern: marker.pattern,
    })),
    mindCompileOrder: markers
      .slice()
      .sort((a, b) => a.targetIndex - b.targetIndex)
      .map((marker) => marker.assetPng),
  };
}

function readme() {
  return `# Marker Sheet A0 v1

This is the active multi-marker tracking sheet for QRcode-AR.

- Format: A0 landscape, ${sheet.widthMm} x ${sheet.heightMm} mm
- Runtime target file: \`${sheetId}.mind\`
- Manifest: \`tracking-sheet-manifest.json\`
- Verification report: \`tracking-sheet-report.json\`
- Target order: \`markers/*.png\` sorted by \`targetIndex\`

The full sheet is not a single image target. Each marker is compiled as an
individual MindAR target, and the app reconstructs the full A0 sheet pose from
the detected marker's known sheet position.

Run \`npm run generate:a0-marker-sheet\` after editing this generator. The
command regenerates marker PNG/SVG files, manifest and preview assets, then
verifies the committed \`.mind\` file has the expected target count and
dimensions. Recompile \`${sheetId}.mind\` from the ordered marker PNGs whenever
marker artwork changes.
`;
}

async function writePngFromSvg(svg, filePath, width) {
  await sharp(Buffer.from(svg)).resize({ width }).png().toFile(filePath);
}

async function inspectMindFile() {
  const require = createRequire(import.meta.url);
  globalThis.require ||= require;
  globalThis.window ||= {};

  const mindarModule = await import(
    pathToFileURL(path.join(projectRoot, "public", "vendor", "mind-ar", "mindar-image.prod.js")).href
  );
  const compiler = new mindarModule.Compiler();
  const data = compiler.importData(await readFile(mindFilePath));

  return data.map((target, targetIndex) => ({
    targetIndex,
    width: target.targetImage?.width || 0,
    height: target.targetImage?.height || 0,
  }));
}

async function markerAssetReport(marker) {
  const pngPath = path.join(outputRoot, marker.assetPng);
  const svgPath = path.join(outputRoot, marker.assetSvg);
  const [pngBuffer, pngMetadata, svgStats] = await Promise.all([
    readFile(pngPath),
    sharp(pngPath).metadata(),
    stat(svgPath),
  ]);

  return {
    id: marker.id,
    targetIndex: marker.targetIndex,
    role: marker.role,
    assetPng: marker.assetPng,
    assetSvg: marker.assetSvg,
    pngWidth: pngMetadata.width || 0,
    pngHeight: pngMetadata.height || 0,
    pngChannels: pngMetadata.channels || 0,
    pngSha256: createHash("sha256").update(pngBuffer).digest("hex"),
    svgBytes: svgStats.size,
    sheetPosition: {
      x: fixed(marker.x),
      y: fixed(marker.y),
      width: fixed(marker.width),
      height: fixed(marker.height),
      rotationDeg: marker.rotationDeg,
    },
  };
}

async function buildVerificationReport() {
  const orderedMarkers = markers.slice().sort((a, b) => a.targetIndex - b.targetIndex);
  const markerReports = await Promise.all(orderedMarkers.map(markerAssetReport));
  const mindTargets = await inspectMindFile();
  const manifestOrder = orderedMarkers.map((marker) => marker.assetPng);
  const targetIndexOrderOk = orderedMarkers.every((marker, index) => marker.targetIndex === index);
  const markerPngsAre1024Square = markerReports.every(
    (marker) => marker.pngWidth === 1024 && marker.pngHeight === 1024
  );
  const mindTargetCountMatchesManifest = mindTargets.length === orderedMarkers.length;
  const mindTargetDimensionsMatchMarkers = mindTargets.every((target, index) => {
    const marker = markerReports[index];
    return Boolean(marker) && target.width === marker.pngWidth && target.height === marker.pngHeight;
  });
  const ok =
    targetIndexOrderOk &&
    markerPngsAre1024Square &&
    mindTargetCountMatchesManifest &&
    mindTargetDimensionsMatchMarkers;

  const report = {
    generatedAt: new Date().toISOString(),
    sheetId,
    version,
    format: sheet.format,
    orientation: sheet.orientation,
    physicalSize: {
      widthMm: sheet.widthMm,
      heightMm: sheet.heightMm,
    },
    maxTrack: 1,
    manifestOrder,
    checks: {
      targetIndexOrderOk,
      markerPngsAre1024Square,
      mindTargetCountMatchesManifest,
      mindTargetDimensionsMatchMarkers,
      markerImagesMatchCompiledContent: "not encoded in MindAR export; use pngSha256 and compile order as source of truth",
    },
    mindFile: {
      path: `${sheetId}.mind`,
      targetCount: mindTargets.length,
      targets: mindTargets,
    },
    markers: markerReports,
    ok,
  };

  if (!ok) {
    throw new Error(`A0 marker sheet verification failed: ${JSON.stringify(report.checks)}`);
  }

  return report;
}

async function main() {
  await mkdir(markersRoot, { recursive: true });

  for (const marker of markers) {
    const svg = markerSvg(marker.id);
    const base = path.join(markersRoot, marker.id);
    await writeFile(`${base}.svg`, svg, "utf8");
    await writePngFromSvg(svg, `${base}.png`, 1024);
  }

  const previewSvg = layoutPreviewSvg();
  await writeFile(path.join(outputRoot, "layout-preview-a0.svg"), previewSvg, "utf8");
  await writePngFromSvg(previewSvg, path.join(outputRoot, "layout-preview-a0.png"), sheet.widthMm * 3);
  await writeFile(
    path.join(outputRoot, "tracking-sheet-manifest.json"),
    `${JSON.stringify(manifest(), null, 2)}\n`,
    "utf8",
  );
  await writeFile(path.join(outputRoot, "README.md"), readme(), "utf8");
  const report = await buildVerificationReport();
  await writeFile(
    path.join(outputRoot, "tracking-sheet-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );

  return {
    outputRoot,
    markerCount: markers.length,
    mindTargetCount: report.mindFile.targetCount,
    targetIndexOrderOk: report.checks.targetIndexOrderOk,
    markerPngsAre1024Square: report.checks.markerPngsAre1024Square,
    mindTargetCountMatchesManifest: report.checks.mindTargetCountMatchesManifest,
    mindTargetDimensionsMatchMarkers: report.checks.mindTargetDimensionsMatchMarkers,
    preview: "A0",
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
