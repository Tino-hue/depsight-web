// 3D 力导向图视图（Three.js）
// 从 js/graph3d.js 迁移：节点大小 = children 数 + self_size；颜色 = 健康分；
// score < 50 脉动；精灵标签；OrbitControls；点击/悬停；搜索定位；高亮依赖路径
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Crosshair, Route, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtBytes } from "@/lib/analyzer";
import type { AnalysisResult, DepGraph, SelectedNodeInfo } from "@/lib/types";
import { useApp } from "@/state/AppContext";

// ===== 3D 引擎（与旧版 graph3d.js 行为一致）=====
interface NodeEntry {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshPhongMaterial>;
  node: { id: string; name: string; version: string; depth: number };
  health: number;
  meta?: AnalysisResult["node_metas"][string];
}

interface PulseEntry {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshPhongMaterial>;
  phase: number;
}

class GraphEngine {
  private container: HTMLElement;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private controls!: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private nodeGroup: THREE.Group | null = null;
  private edgeGroup: THREE.Group | null = null;
  private nodeMeshes: NodeEntry[] = [];
  private edgeLines: THREE.Line[] = [];
  private pulseNodes: PulseEntry[] = [];
  private highlightNodes = new Set<string>();
  private animationId = 0;
  private disposed = false;
  onSelect: ((info: SelectedNodeInfo | null) => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    const width = container.clientWidth;
    const height = container.clientHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0f1117);
    this.scene.fog = new THREE.Fog(0x0f1117, 200, 800);

    this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    this.camera.position.set(0, 0, 120);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambientLight);
    const pointLight = new THREE.PointLight(0xffffff, 1, 300);
    pointLight.position.set(50, 50, 50);
    this.scene.add(pointLight);
    const pointLight2 = new THREE.PointLight(0x6366f1, 0.5, 200);
    pointLight2.position.set(-50, -30, -50);
    this.scene.add(pointLight2);

    this.raycaster.params.Points = { threshold: 5 };

    this.renderer.domElement.addEventListener("click", this.onCanvasClick);
    this.renderer.domElement.addEventListener(
      "mousemove",
      this.onCanvasMouseMove,
    );
    window.addEventListener("resize", this.onWindowResize);

    this.animate();
  }

  updateData(graphData: DepGraph, analysisResult: AnalysisResult | null) {
    this.clearGraph();

    const { nodes, edges } = graphData;
    const healthMap = new Map<string, number>();
    const metaMap = new Map<string, AnalysisResult["node_metas"][string]>();

    if (analysisResult) {
      for (const h of analysisResult.health_scores || []) {
        healthMap.set(h.node_id, h.total);
      }
      for (const [id, m] of Object.entries(analysisResult.node_metas || {})) {
        metaMap.set(id, m);
      }
    }

    // children 数量决定节点大小
    const childrenCount = new Map<string, number>();
    for (const e of edges) {
      childrenCount.set(e.from, (childrenCount.get(e.from) || 0) + 1);
    }

    this.nodeGroup = new THREE.Group();
    const nodePositions = new Map<string, THREE.Vector3>();

    for (const node of nodes) {
      const score = healthMap.get(node.id) ?? 50;
      const meta = metaMap.get(node.id);
      const childCount = childrenCount.get(node.id) || 0;
      const selfSize = meta?.self_size || 0;

      const sizeBonus = Math.min(childCount * 0.3, 3);
      const sizeBonus2 =
        selfSize > 0 ? Math.min(Math.log10(selfSize / 1000 + 1), 3) : 0;
      const radius = 3 + sizeBonus + sizeBonus2;

      const color = getHealthColor(score);
      const pos = computeNodePosition(node.depth || 0);

      const geometry = new THREE.SphereGeometry(radius, 24, 24);
      const material = new THREE.MeshPhongMaterial({
        color,
        emissive: color,
        emissiveIntensity: score < 50 ? 0.3 : 0.1,
        shininess: 50,
        transparent: true,
        opacity: 0.92,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(pos);
      mesh.userData = { nodeId: node.id };

      this.nodeGroup.add(mesh);
      this.nodeMeshes.push({ mesh, node, health: score, meta });
      nodePositions.set(node.id, pos);

      if (score < 50) {
        this.pulseNodes.push({ mesh, phase: Math.random() * Math.PI * 2 });
      }

      // 精灵标签
      const label = createTextSprite(node.name.split("/").pop() || node.name);
      label.position.copy(pos).add(new THREE.Vector3(0, radius + 2, 0));
      this.nodeGroup.add(label);
    }
    this.scene.add(this.nodeGroup);

    // 边
    this.edgeGroup = new THREE.Group();
    const depthMap = new Map(nodes.map((n) => [n.id, n.depth]));
    for (const edge of edges) {
      const fromPos = nodePositions.get(edge.from);
      const toPos = nodePositions.get(edge.to);
      if (!fromPos || !toPos) continue;

      const depth = depthMap.get(edge.from) ?? 0;
      const geometry = new THREE.BufferGeometry().setFromPoints([
        fromPos,
        toPos,
      ]);
      const material = new THREE.LineBasicMaterial({
        color: 0x3a4156,
        opacity: Math.max(0.15, 0.4 - depth * 0.08),
        transparent: true,
      });
      const line = new THREE.Line(geometry, material);
      line.userData = { from: edge.from, to: edge.to };
      this.edgeGroup.add(line);
      this.edgeLines.push(line);
    }
    this.scene.add(this.edgeGroup);

    this.fitCamera(nodes.length);
  }

  focusNode(query: string | null) {
    if (!query) {
      this.resetView();
      return;
    }
    const found = this.nodeMeshes.find(
      (n) => n.node.id === query || n.node.name.includes(query),
    );
    if (!found) return;
    this.selectNode(found);
    const pos = found.mesh.position;
    this.controls.target.copy(pos);
    this.camera.position.set(pos.x + 30, pos.y + 20, pos.z + 40);
    this.controls.update();
  }

  highlightPath(query: string) {
    const found = this.nodeMeshes.find(
      (n) => n.node.id === query || n.node.name.includes(query),
    );
    if (!found) return;
    this.highlightDependencyPath(found.node.id);
  }

  clearHighlights() {
    this.highlightNodes.clear();
    for (const { mesh } of this.nodeMeshes) {
      mesh.material.emissiveIntensity = 0.1;
    }
  }

  resetView() {
    this.clearHighlights();
    this.onSelect?.(null);
    this.fitCamera(this.nodeMeshes.length);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.animationId);
    window.removeEventListener("resize", this.onWindowResize);
    this.renderer.domElement.removeEventListener("click", this.onCanvasClick);
    this.renderer.domElement.removeEventListener(
      "mousemove",
      this.onCanvasMouseMove,
    );
    this.clearGraph();
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }

  // ---- 内部 ----
  private selectNode(entry: NodeEntry) {
    const { node, health, meta } = entry;
    this.highlightNodes.clear();
    this.highlightNodes.add(node.id);
    // 高亮相邻节点
    for (const line of this.edgeLines) {
      const { from, to } = line.userData as { from: string; to: string };
      if (from === node.id) this.highlightNodes.add(to);
      if (to === node.id) this.highlightNodes.add(from);
    }
    this.onSelect?.({ node, health, meta });
  }

  private highlightDependencyPath(fromId: string) {
    this.highlightNodes.clear();
    const adj = new Map<string, string[]>();
    for (const line of this.edgeLines) {
      const { from, to } = line.userData as { from: string; to: string };
      if (!adj.has(from)) adj.set(from, []);
      adj.get(from)!.push(to);
    }
    const visited = new Set([fromId]);
    const queue = [fromId];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      this.highlightNodes.add(cur);
      for (const next of adj.get(cur) || []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
  }

  private clearGraph() {
    if (this.nodeGroup) {
      this.nodeGroup.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Sprite) {
          obj.geometry?.dispose?.();
          const mat = obj.material as THREE.Material | THREE.Material[];
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat?.dispose?.();
        }
      });
      this.scene.remove(this.nodeGroup);
    }
    if (this.edgeGroup) {
      for (const line of this.edgeLines) {
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
      }
      this.scene.remove(this.edgeGroup);
    }
    this.nodeGroup = null;
    this.edgeGroup = null;
    this.nodeMeshes = [];
    this.edgeLines = [];
    this.pulseNodes = [];
    this.highlightNodes.clear();
  }

  private fitCamera(nodeCount: number) {
    const dist = Math.max(80, nodeCount * 12);
    this.camera.position.set(dist * 0.6, dist * 0.4, dist);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  private animate = () => {
    if (this.disposed) return;
    this.animationId = requestAnimationFrame(this.animate);

    const t = Date.now() * 0.003;
    for (const p of this.pulseNodes) {
      const s = 1 + 0.15 * Math.sin(t * 2 + p.phase);
      p.mesh.scale.setScalar(s);
      p.mesh.material.emissiveIntensity = 0.3 + 0.2 * Math.sin(t * 3 + p.phase);
    }
    for (const { mesh } of this.nodeMeshes) {
      if (this.highlightNodes.has(mesh.userData.nodeId as string)) {
        mesh.material.emissiveIntensity = 0.5 + 0.3 * Math.sin(t * 4);
      }
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private setMouseFromEvent(event: MouseEvent) {
    const rect = this.container.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private onCanvasClick = (event: MouseEvent) => {
    this.setMouseFromEvent(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const meshes = this.nodeMeshes.map((n) => n.mesh);
    const intersects = this.raycaster.intersectObjects(meshes, false);
    if (intersects.length > 0) {
      const obj = intersects[0].object as NodeEntry["mesh"];
      const entry = this.nodeMeshes.find((n) => n.mesh === obj);
      if (entry) this.selectNode(entry);
    }
  };

  private onCanvasMouseMove = (event: MouseEvent) => {
    this.setMouseFromEvent(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const meshes = this.nodeMeshes.map((n) => n.mesh);
    const intersects = this.raycaster.intersectObjects(meshes, false);
    this.renderer.domElement.style.cursor =
      intersects.length > 0 ? "pointer" : "grab";
  };

  private onWindowResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };
}

function getHealthColor(score: number): THREE.Color {
  if (score >= 80) return new THREE.Color(0x10b981);
  if (score >= 60) return new THREE.Color(0xf59e0b);
  return new THREE.Color(0xef4444);
}

function computeNodePosition(depth: number): THREE.Vector3 {
  const angle = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  const baseRadius = 20 + depth * 25;
  const jitter = 0.7 + Math.random() * 0.6;
  const r = baseRadius * jitter;
  return new THREE.Vector3(
    r * Math.sin(phi) * Math.cos(angle),
    r * Math.sin(phi) * Math.sin(angle),
    r * Math.cos(phi),
  );
}

function createTextSprite(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  canvas.width = 256;
  canvas.height = 64;
  ctx.fillStyle = "rgba(0,0,0,0)";
  ctx.fillRect(0, 0, 256, 64);
  ctx.font = 'bold 28px Sora, -apple-system, "Segoe UI", sans-serif';
  ctx.fillStyle = "#e2e8f0";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 32);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(12, 3, 1);
  return sprite;
}

// ===== React 组件 =====
export function GraphView() {
  const { lastGraph, lastResult } = useApp();
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GraphEngine | null>(null);
  const [selected, setSelected] = useState<SelectedNodeInfo | null>(null);
  const [search, setSearch] = useState("");

  // 初始化引擎（仅一次）
  useEffect(() => {
    if (!containerRef.current) return;
    const engine = new GraphEngine(containerRef.current);
    engine.onSelect = setSelected;
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  // 数据更新
  useEffect(() => {
    if (lastGraph && engineRef.current) {
      engineRef.current.updateData(lastGraph, lastResult);
      engineRef.current.resetView();
      setSelected(null);
    }
  }, [lastGraph, lastResult]);

  const onSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && search.trim()) {
        engineRef.current?.focusNode(search.trim());
      }
    },
    [search],
  );

  const onHighlight = useCallback(() => {
    if (search.trim()) engineRef.current?.highlightPath(search.trim());
  }, [search]);

  const onReset = useCallback(() => {
    setSearch("");
    setSelected(null);
    engineRef.current?.resetView();
  }, []);

  const healthClass =
    selected && selected.health >= 80
      ? "score-good"
      : selected && selected.health >= 60
        ? "score-mid"
        : "score-bad";
  const healthLabel = !selected
    ? ""
    : selected.health >= 80
      ? "健康"
      : selected.health >= 60
        ? "警告"
        : "危险";

  return (
    <div className="relative h-[calc(100vh-3.5rem)] w-full overflow-hidden">
      {/* 3D 画布 */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* 浮动工具栏 */}
      <div className="absolute left-1/2 top-4 z-10 flex w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 items-center gap-2 rounded-lg border border-border bg-background/70 p-2 backdrop-blur-md">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={onSearchKeyDown}
          placeholder="搜索节点，回车定位"
          className="bg-transparent font-mono text-xs"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={onHighlight}
          title="高亮该节点的全部下游依赖"
        >
          <Route className="h-4 w-4" />
          <span className="hidden sm:inline">依赖路径</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onReset}
          title="重置视角并清除高亮"
        >
          <RotateCcw className="h-4 w-4" />
          <span className="hidden sm:inline">重置</span>
        </Button>
      </div>

      {/* 选中信息提示 */}
      {selected && (
        <div className="absolute bottom-4 left-4 z-10 max-w-xs animate-fade-in rounded-lg border border-border bg-background/80 p-4 backdrop-blur-md">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h4 className="break-all font-mono text-sm font-semibold">
              {selected.node.id}
            </h4>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => {
                setSelected(null);
                engineRef.current?.clearHighlights();
              }}
              aria-label="关闭详情"
            >
              <Crosshair className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">健康分</span>
              <span className={`font-semibold ${healthClass}`}>
                {selected.health}（{healthLabel}）
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">深度</span>
              <span className="tabular-nums">{selected.node.depth}</span>
            </div>
            {selected.meta && (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">许可证</span>
                  <span>{selected.meta.license || "未声明"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">最新版本</span>
                  <span className="font-mono">
                    {selected.meta.latest_version || selected.node.version}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">体积</span>
                  <span className="tabular-nums">
                    {fmtBytes(selected.meta.self_size || 0)}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 空数据提示 */}
      {!lastGraph && (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <div className="rounded-lg border border-border bg-background/80 px-6 py-8 text-center backdrop-blur-md">
            <p className="text-sm text-muted-foreground">
              暂无图数据，请先在 Analyze 视图完成一次分析
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
