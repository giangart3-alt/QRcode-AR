"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import {
  createDefaultPlacement,
  DEFAULT_MARKER_HEIGHT_MM,
  DEFAULT_MARKER_WIDTH_MM,
  degreesToRadians,
  metersToMm,
  mmToMeters,
  normalizePlacement,
  radiansToDegrees,
  type PlacementMetadata
} from "@/lib/placement";
import type { ProjectMetadata } from "@/lib/projects";
import { loadGltfModel } from "@/lib/three-gltf";

type TransformMode = "translate" | "rotate" | "scale";

export function EditorClient({ id }: { id: string }) {
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const modelRef = useRef<THREE.Object3D | null>(null);
  const markerPlaneRef = useRef<THREE.Mesh | null>(null);
  const transformRef = useRef<TransformControls | null>(null);
  const baseModelSizeRef = useRef(1);
  const placementRef = useRef<PlacementMetadata>(createDefaultPlacement());

  const [project, setProject] = useState<ProjectMetadata | null>(null);
  const [placement, setPlacement] = useState<PlacementMetadata>(() =>
    createDefaultPlacement()
  );
  const [password, setPassword] = useState(() =>
    typeof window === "undefined" ? "" : window.sessionStorage.getItem("adminPassword") || ""
  );
  const [mode, setMode] = useState<TransformMode>("translate");
  const [status, setStatus] = useState("Loading project...");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const applyPlacementToScene = useCallback((nextPlacement: PlacementMetadata) => {
    const model = modelRef.current;
    if (model) {
      model.position.set(
        mmToMeters(nextPlacement.position.x),
        mmToMeters(nextPlacement.position.y),
        mmToMeters(nextPlacement.position.z)
      );
      model.rotation.set(
        degreesToRadians(nextPlacement.rotation.x),
        degreesToRadians(nextPlacement.rotation.y),
        degreesToRadians(nextPlacement.rotation.z)
      );
      model.scale.setScalar(nextPlacement.scale);
    }

    const markerPlane = markerPlaneRef.current;
    if (markerPlane) {
      markerPlane.scale.set(
        mmToMeters(nextPlacement.markerWidthMm || DEFAULT_MARKER_WIDTH_MM),
        mmToMeters(nextPlacement.markerHeightMm || DEFAULT_MARKER_HEIGHT_MM),
        1
      );
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadProject() {
      const response = await fetch(`/api/projects/${id}`, { cache: "no-store" });
      const result = (await response.json()) as {
        project?: ProjectMetadata;
        error?: string;
      };

      if (cancelled) return;

      if (!response.ok || !result.project) {
        setError(result.error || "Project not found.");
        setStatus("Unable to load project.");
        return;
      }

      setProject(result.project);
      setPlacement(projectPlacement(result.project));
      setStatus("Project loaded.");
    }

    loadProject().catch((caught) => {
      setError(caught instanceof Error ? caught.message : "Unable to load project.");
      setStatus("Unable to load project.");
    });

    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!project || !canvasHostRef.current) return;

    const activeProject = project;
    const marker = activeProject.marker;
    const host = canvasHostRef.current;
    let stopped = false;
    let animationFrame = 0;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf3f6f5);

    const camera = new THREE.PerspectiveCamera(48, 1, 0.01, 200);
    const maxMarkerMeters = Math.max(
      mmToMeters(marker.widthMm),
      mmToMeters(marker.heightMm)
    );
    camera.position.set(0.35, maxMarkerMeters * 0.75, maxMarkerMeters * 0.9);
    camera.lookAt(0, 0, 0);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.target.set(0, 0, 0);

    const ambient = new THREE.AmbientLight(0xffffff, 1.5);
    scene.add(ambient);
    const hemisphere = new THREE.HemisphereLight(0xffffff, 0x60706c, 2.2);
    scene.add(hemisphere);
    const directional = new THREE.DirectionalLight(0xffffff, 2.4);
    directional.position.set(2, 4, 3);
    scene.add(directional);

    const texture = new THREE.TextureLoader().load(marker.imageUrl);
    texture.colorSpace = THREE.SRGBColorSpace;
    const markerPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.8,
        metalness: 0,
        side: THREE.DoubleSide
      })
    );
    markerPlane.rotation.x = -Math.PI / 2;
    markerPlane.receiveShadow = true;
    scene.add(markerPlane);
    markerPlaneRef.current = markerPlane;

    const border = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
      new THREE.LineBasicMaterial({ color: 0x101615 })
    );
    border.rotation.x = -Math.PI / 2;
    markerPlane.add(border);

    const grid = new THREE.GridHelper(maxMarkerMeters, 10, 0x0f766e, 0x9aa8a4);
    grid.position.y = 0.002;
    scene.add(grid);

    const axes = new THREE.AxesHelper(Math.min(maxMarkerMeters * 0.28, 0.3));
    axes.position.set(0, 0.01, 0);
    scene.add(axes);

    const transform = new TransformControls(camera, renderer.domElement);
    transform.setMode("translate");
    transform.setSpace("local");
    transformRef.current = transform;
    const transformHelper = transform.getHelper();
    scene.add(transformHelper);

    transform.addEventListener("dragging-changed", (event) => {
      orbit.enabled = !(event as { value?: boolean }).value;
    });
    transform.addEventListener("objectChange", () => {
      const model = modelRef.current;
      if (!model) return;

      setPlacement((current) => ({
        ...current,
        position: {
          x: roundForStorage(metersToMm(model.position.x)),
          y: roundForStorage(metersToMm(model.position.y)),
          z: roundForStorage(metersToMm(model.position.z))
        },
        rotation: {
          x: roundForStorage(radiansToDegrees(model.rotation.x)),
          y: roundForStorage(radiansToDegrees(model.rotation.y)),
          z: roundForStorage(radiansToDegrees(model.rotation.z))
        },
        scale: roundForStorage(
          (Math.abs(model.scale.x) + Math.abs(model.scale.y) + Math.abs(model.scale.z)) / 3
        )
      }));
    });

    async function loadModel() {
      setStatus("Loading GLB model...");

      try {
        if (!activeProject.modelUrl) {
          throw new Error("Active scene does not have a GLB model yet.");
        }

        const gltf = await loadGltfModel(activeProject.modelUrl);
        if (stopped) return;

        const model = gltf.scene;
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        scene.add(model);
        modelRef.current = model;
        transform.attach(model);
        const bbox = new THREE.Box3().setFromObject(model);
        const size = bbox.getSize(new THREE.Vector3());
        baseModelSizeRef.current = Math.max(size.x, size.y, size.z, 0.001);
        applyPlacementToScene(placementRef.current);
        setStatus("Model loaded. Move, rotate, or scale it on the marker plane.");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Unable to load GLB model.");
        setStatus("Model loading failed.");
      }
    }

    function resize() {
      const bounds = host.getBoundingClientRect();
      const width = Math.max(bounds.width, 320);
      const height = Math.max(bounds.height, 360);
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    function animate() {
      if (stopped) return;
      animationFrame = window.requestAnimationFrame(animate);
      orbit.update();
      renderer.render(scene, camera);
    }

    resize();
    window.addEventListener("resize", resize);
    loadModel();
    animate();

    return () => {
      stopped = true;
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      transform.detach();
      transform.dispose();
      transformHelper.dispose();
      orbit.dispose();
      texture.dispose();
      markerPlane.geometry.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      modelRef.current = null;
      markerPlaneRef.current = null;
      transformRef.current = null;
    };
  }, [project, applyPlacementToScene]);

  useEffect(() => {
    transformRef.current?.setMode(mode);
  }, [mode]);

  useEffect(() => {
    placementRef.current = placement;
    applyPlacementToScene(placement);
  }, [placement, applyPlacementToScene]);

  async function savePlacement() {
    if (!project) return;
    setSaving(true);
    setError("");
    setStatus("Saving placement...");

    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, placement })
      });
      const result = (await response.json()) as {
        project?: ProjectMetadata;
        error?: string;
      };

      if (!response.ok || !result.project) {
        throw new Error(result.error || "Unable to save placement.");
      }

      window.sessionStorage.setItem("adminPassword", password);
      setProject(result.project);
      setPlacement(projectPlacement(result.project));
      setStatus("Placement saved. Phone AR will use these values.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save placement.");
      setStatus("Save failed.");
    } finally {
      setSaving(false);
    }
  }

  function resetPlacement() {
    if (!project) return;
    setPlacement({
      ...createDefaultPlacement(project.scale, project.verticalOffset),
      markerImage: project.marker.imageUrl,
      markerWidthMm: project.marker.widthMm,
      markerHeightMm: project.marker.heightMm
    });
    setStatus("Placement reset to project defaults.");
  }

  function centerModel() {
    updatePlacement((current) => ({
      ...current,
      position: { x: 0, y: current.position.y, z: 0 }
    }));
  }

  function fitModelToMarker() {
    const targetMeters =
      Math.min(
        placement.markerWidthMm || project?.marker.widthMm || DEFAULT_MARKER_WIDTH_MM,
        placement.markerHeightMm || project?.marker.heightMm || DEFAULT_MARKER_HEIGHT_MM
      ) / 1000 / 3;
    const nextScale = Math.max(targetMeters / baseModelSizeRef.current, 0.001);
    updatePlacement((current) => ({ ...current, scale: roundForStorage(nextScale) }));
    setStatus("Model scaled to roughly one third of the marker short side.");
  }

  function rotateAxis(axis: "x" | "y" | "z") {
    updatePlacement((current) => ({
      ...current,
      rotation: {
        ...current.rotation,
        [axis]: roundForStorage(current.rotation[axis] + 90)
      }
    }));
  }

  function updatePlacement(updater: (current: PlacementMetadata) => PlacementMetadata) {
    setPlacement((current) => normalizePlacement(updater(current), current.scale));
  }

  function setMarkerNumber(field: "markerWidthMm" | "markerHeightMm", value: string) {
    const parsed = parseDecimal(value);
    if (parsed === null || parsed <= 0) return;
    updatePlacement((current) => ({ ...current, [field]: parsed }));
  }

  function setPositionNumber(field: "x" | "y" | "z", value: string) {
    const parsed = parseDecimal(value);
    if (parsed === null) return;
    updatePlacement((current) => ({
      ...current,
      position: { ...current.position, [field]: parsed }
    }));
  }

  function setRotationNumber(field: "x" | "y" | "z", value: string) {
    const parsed = parseDecimal(value);
    if (parsed === null) return;
    updatePlacement((current) => ({
      ...current,
      rotation: { ...current.rotation, [field]: parsed }
    }));
  }

  function setScaleNumber(value: string) {
    const parsed = parseDecimal(value);
    if (parsed === null || parsed <= 0) return;
    updatePlacement((current) => ({ ...current, scale: parsed }));
  }

  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="mx-auto flex min-h-screen max-w-[1500px] flex-col px-4 py-4">
        <nav className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-4">
          <Link
            className="focus-ring rounded-lg px-3 py-2 text-sm font-semibold text-[var(--muted)] transition hover:bg-white hover:text-[var(--ink)]"
            href="/admin"
          >
            Admin
          </Link>
          <div className="flex flex-wrap gap-2">
            {project ? (
              <>
                <Link className="button-secondary" href={project.arUrl}>
                  Open AR
                </Link>
                <Link className="button-secondary" href={project.viewUrl}>
                  Viewer
                </Link>
                <Link className="button-secondary" href="/marker">
                  Marker
                </Link>
              </>
            ) : null}
          </div>
        </nav>

        <section className="grid flex-1 gap-4 py-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-h-[520px] overflow-hidden rounded-xl border border-[var(--line)] bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
              <div>
                <h1 className="text-xl font-black text-[var(--ink)]">
                  {project?.name || "Placement editor"}
                </h1>
                <p className="mt-1 text-sm text-[var(--muted)]">{status}</p>
              </div>
              <div className="flex rounded-lg border border-[var(--line)] bg-[var(--soft)] p-1">
                {(["translate", "rotate", "scale"] as TransformMode[]).map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={
                      mode === item
                        ? "rounded-md bg-[var(--ink)] px-3 py-2 text-sm font-semibold text-white"
                        : "rounded-md px-3 py-2 text-sm font-semibold text-[var(--muted)] hover:bg-white"
                    }
                    onClick={() => setMode(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
            <div ref={canvasHostRef} className="h-[calc(100vh-180px)] min-h-[520px]" />
          </div>

          <aside className="space-y-4">
            <section className="rounded-xl border border-[var(--line)] bg-white p-4 shadow-sm">
              <h2 className="text-lg font-black text-[var(--ink)]">Marker size</h2>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <NumberField
                  label="Width mm"
                  value={placement.markerWidthMm || project?.marker.widthMm || DEFAULT_MARKER_WIDTH_MM}
                  onChange={(value) => setMarkerNumber("markerWidthMm", value)}
                />
                <NumberField
                  label="Height mm"
                  value={placement.markerHeightMm || project?.marker.heightMm || DEFAULT_MARKER_HEIGHT_MM}
                  onChange={(value) => setMarkerNumber("markerHeightMm", value)}
                />
              </div>
            </section>

            <section className="rounded-xl border border-[var(--line)] bg-white p-4 shadow-sm">
              <h2 className="text-lg font-black text-[var(--ink)]">Position mm</h2>
              <div className="mt-4 grid grid-cols-3 gap-3">
                {(["x", "y", "z"] as const).map((axis) => (
                  <NumberField
                    key={axis}
                    label={axis.toUpperCase()}
                    value={placement.position[axis]}
                    onChange={(value) => setPositionNumber(axis, value)}
                  />
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-[var(--line)] bg-white p-4 shadow-sm">
              <h2 className="text-lg font-black text-[var(--ink)]">Rotation degrees</h2>
              <div className="mt-4 grid grid-cols-3 gap-3">
                {(["x", "y", "z"] as const).map((axis) => (
                  <NumberField
                    key={axis}
                    label={axis.toUpperCase()}
                    value={placement.rotation[axis]}
                    onChange={(value) => setRotationNumber(axis, value)}
                  />
                ))}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <button type="button" className="button-secondary" onClick={() => rotateAxis("x")}>
                  +90 X
                </button>
                <button type="button" className="button-secondary" onClick={() => rotateAxis("y")}>
                  +90 Y
                </button>
                <button type="button" className="button-secondary" onClick={() => rotateAxis("z")}>
                  +90 Z
                </button>
              </div>
            </section>

            <section className="rounded-xl border border-[var(--line)] bg-white p-4 shadow-sm">
              <h2 className="text-lg font-black text-[var(--ink)]">Scale</h2>
              <div className="mt-4">
                <NumberField
                  label="Scale"
                  value={placement.scale}
                  onChange={setScaleNumber}
                />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" className="button-secondary" onClick={centerModel}>
                  Center model
                </button>
                <button type="button" className="button-secondary" onClick={fitModelToMarker}>
                  Fit to marker
                </button>
              </div>
            </section>

            <section className="rounded-xl border border-[var(--line)] bg-white p-4 shadow-sm">
              <label className="block text-sm font-semibold text-[var(--ink)]">
                Admin password
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="focus-ring mt-2 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-3 text-[var(--ink)] shadow-inner"
                  autoComplete="current-password"
                />
              </label>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button type="button" className="button-secondary" onClick={resetPlacement}>
                  Reset placement
                </button>
                <button
                  type="button"
                  disabled={saving || !project}
                  className="focus-ring rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent-dark)] disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={savePlacement}
                >
                  {saving ? "Saving..." : "Save placement"}
                </button>
              </div>
              {error ? (
                <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-900">
                  {error}
                </p>
              ) : null}
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}

function NumberField({
  label,
  value,
  onChange
}: {
  label: string;
  value: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
      {label}
      <input
        type="text"
        inputMode="decimal"
        value={formatNumber(value)}
        onChange={(event) => onChange(event.target.value)}
        className="focus-ring mt-2 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm font-semibold text-[var(--ink)] shadow-inner"
      />
    </label>
  );
}

function parseDecimal(value: string) {
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : String(roundForStorage(value));
}

function roundForStorage(value: number) {
  return Math.round(value * 1000) / 1000;
}

function projectPlacement(project: ProjectMetadata) {
  return {
    ...normalizePlacement(project.placement, project.scale, project.verticalOffset),
    markerImage: project.marker.imageUrl,
    markerWidthMm: project.marker.widthMm,
    markerHeightMm: project.marker.heightMm
  };
}
