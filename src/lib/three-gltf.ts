import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export const DRACO_DECODER_PATH = "https://www.gstatic.com/draco/v1/decoders/";

export async function loadGltfModel(url: string) {
  const loader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
  loader.setDRACOLoader(dracoLoader);

  try {
    return await loader.loadAsync(url);
  } finally {
    dracoLoader.dispose();
  }
}
