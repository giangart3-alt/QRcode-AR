import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { CompilerBase } from "mind-ar/src/image-target/compiler-base.js";
import { buildTrackingImageList } from "mind-ar/src/image-target/image-list.js";
import { extractTrackingFeatures } from "mind-ar/src/image-target/tracker/extract-utils.js";
import "mind-ar/src/image-target/detector/kernels/cpu/index.js";

const inputPath = path.resolve("public/targets/Masteplan_PROMENADE_004.png");
const outputPath = path.resolve("public/targets/masterplan.mind");
const previewPath = path.resolve("public/targets/masterplan-preview.jpg");
const maxCompileWidth = Number(process.env.MINDAR_MAX_WIDTH || 1000);

class SharpCompiler extends CompilerBase {
  createProcessCanvas(img) {
    return {
      getContext() {
        return {
          drawImage() {
            // The image pixels are already decoded by sharp.
          },
          getImageData() {
            return { data: img.rgbaData };
          }
        };
      }
    };
  }

  compileTrack({ progressCallback, targetImages, basePercent }) {
    return new Promise((resolve) => {
      const percentPerImage = (100 - basePercent) / targetImages.length;
      let percent = 0;
      const list = [];

      for (let i = 0; i < targetImages.length; i += 1) {
        const targetImage = targetImages[i];
        const imageList = buildTrackingImageList(targetImage);
        const percentPerAction = percentPerImage / imageList.length;
        const trackingData = extractTrackingFeatures(imageList, () => {
          percent += percentPerAction;
          progressCallback(basePercent + percent);
        });
        list.push(trackingData);
      }

      resolve(list);
    });
  }
}

async function main() {
  const { data, info } = await sharp(inputPath)
    .rotate()
    .resize({ width: maxCompileWidth, withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const image = {
    width: info.width,
    height: info.height,
    rgbaData: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength)
  };

  console.log(`Compiling MindAR target from ${path.relative(process.cwd(), inputPath)}`);
  console.log(`Feature image: ${image.width} x ${image.height}px`);

  const compiler = new SharpCompiler();
  let lastPercent = -1;
  await compiler.compileImageTargets([image], (percent) => {
    const rounded = Math.floor(percent);
    if (rounded !== lastPercent && rounded % 5 === 0) {
      lastPercent = rounded;
      console.log(`Progress ${rounded}%`);
    }
  });

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, compiler.exportData());
  console.log(`Wrote ${path.relative(process.cwd(), outputPath)}`);

  await sharp(inputPath)
    .rotate()
    .resize({ width: 2400, withoutEnlargement: true })
    .jpeg({ quality: 86, mozjpeg: true })
    .toFile(previewPath);
  console.log(`Wrote ${path.relative(process.cwd(), previewPath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
