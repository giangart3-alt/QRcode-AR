declare module "mind-ar/dist/mindar-image.prod.js" {
  export class Controller {
    inputWidth: number;
    inputHeight: number;

    constructor(options: {
      inputWidth: number;
      inputHeight: number;
      maxTrack?: number;
      filterMinCF?: number | null;
      filterBeta?: number | null;
      warmupTolerance?: number | null;
      missTolerance?: number | null;
      onUpdate?: (data: { type: string; targetIndex?: number; worldMatrix?: number[] | null }) => void;
    });

    addImageTargets(src: string): Promise<{ dimensions: Array<[number, number]> }>;
    dummyRun(video: HTMLVideoElement): Promise<void>;
    processVideo(video: HTMLVideoElement): void;
    stopProcessVideo(): void;
    getProjectionMatrix(): number[];
  }
}
