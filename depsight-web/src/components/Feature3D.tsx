// Features 区块右侧的 3D 装饰：Three.js 发光线框依赖星座
// 中心为线框二十面体（核心引擎），外围环绕带名称标签的渐变球节点（依赖包）
// 透明底（无边缘硬边）、渐变球体质感、整体缓慢旋转 + 节点脉冲浮动，支持深浅色
import { useEffect, useRef } from "react";
import * as THREE from "three";

interface Feature3DProps {
  theme: "dark" | "light";
  className?: string;
}

/** 生成球体渐变贴图（左上受光、右下暗部），让纯色球有体积感 */
function makeSphereTexture(isDark: boolean): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(48, 44, 8, 64, 64, 72);
  if (isDark) {
    g.addColorStop(0, "#86ffb0");
    g.addColorStop(0.35, "#4ade80");
    g.addColorStop(0.75, "#16a34a");
    g.addColorStop(1, "#052e12");
  } else {
    g.addColorStop(0, "#86ffb0");
    g.addColorStop(0.35, "#4ade80");
    g.addColorStop(0.75, "#16a34a");
    g.addColorStop(1, "#052e12");
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/** 生成文字标签贴图（依赖包名） */
function makeLabelTexture(text: string, isDark: boolean): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 72;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 256, 72);
  ctx.font = "600 30px 'Sora', 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = isDark
    ? "rgba(134, 239, 172, 0.92)"
    : "rgba(21, 128, 61, 0.88)";
  ctx.fillText(text, 128, 36);
  return new THREE.CanvasTexture(c);
}

const NODE_NAMES = [
  "core",
  "wkgp",
  "fs",
  "json5",
  "async",
  "cc",
  "time",
  "cli",
  "test",
  "yaml",
];

export function Feature3D({ theme, className }: Feature3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const isDark = theme === "dark";
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 0.4, 7);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // 关键：完全透明清屏，消除矩形黑底边缘
    renderer.setClearColor(0x000000, 0);
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    // ---------- 光照（配合 StandardMaterial 产生明暗层次） ----------
    const ambient = new THREE.AmbientLight(
      isDark ? 0x1a3a24 : 0x3a5a44,
      isDark ? 0.7 : 0.9,
    );
    scene.add(ambient);
    const keyLight = new THREE.DirectionalLight(0xffffff, isDark ? 1.1 : 0.9);
    keyLight.position.set(-3, 4, 5);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x22c55e, 0.35);
    rimLight.position.set(4, -2, -3);
    scene.add(rimLight);

    // ---------- 中心线框多面体（核心引擎） ----------
    const coreGeo = new THREE.IcosahedronGeometry(1.05, 1);
    const coreMat = new THREE.MeshBasicMaterial({
      color: isDark ? "#22c55e" : "#16a34a",
      wireframe: true,
      transparent: true,
      opacity: isDark ? 0.5 : 0.42,
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    scene.add(core);

    // 内核实心球（微弱发光感）
    const innerGeo = new THREE.SphereGeometry(0.52, 24, 24);
    const innerMat = new THREE.MeshStandardMaterial({
      color: isDark ? "#052e12" : "#052e12",
      emissive: isDark ? "#22c55e" : "#4ade80",
      emissiveIntensity: isDark ? 0.4 : 0.28,
      roughness: 0.3,
      metalness: 0.1,
    });
    const inner = new THREE.Mesh(innerGeo, innerMat);
    scene.add(inner);

    // ---------- 外围球节点（渐变贴图 + 名称标签） ----------
    const sphereTex = makeSphereTexture(isDark);
    const nodeGeo = new THREE.SphereGeometry(0.17, 28, 28);
    const nodeBaseMat = new THREE.MeshStandardMaterial({
      map: sphereTex,
      roughness: 0.45,
      metalness: 0.05,
    });

    const NODES = 10;
    const nodes: THREE.Mesh[] = [];
    const nodeBase: THREE.Vector3[] = [];
    const labels: THREE.Sprite[] = [];

    for (let i = 0; i < NODES; i++) {
      // 斐波那契球面均匀分布
      const phi = Math.acos(1 - (2 * (i + 0.5)) / NODES);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      const r = 2.4;
      const pos = new THREE.Vector3(
        r * Math.cos(theta) * Math.sin(phi),
        r * Math.sin(theta) * Math.sin(phi),
        r * Math.cos(phi),
      );
      const mesh = new THREE.Mesh(nodeGeo, nodeBaseMat.clone());
      mesh.position.copy(pos);
      scene.add(mesh);
      nodes.push(mesh);
      nodeBase.push(pos);

      // 名称标签 sprite
      const labelTex = makeLabelTexture(NODE_NAMES[i], isDark);
      const labelMat = new THREE.SpriteMaterial({
        map: labelTex,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      });
      const label = new THREE.Sprite(labelMat);
      label.scale.set(0.9, 0.25, 1);
      label.position.copy(pos).multiplyScalar(1.22); // 稍微外移
      scene.add(label);
      labels.push(label);
    }

    // ---------- 连线：中心-节点 + 相邻节点环 ----------
    const lineMat = new THREE.LineBasicMaterial({
      color: isDark ? "#22c55e" : "#16a34a",
      transparent: true,
      opacity: isDark ? 0.22 : 0.16,
    });

    const lines: THREE.Line[] = [];
    const addLine = (a: THREE.Vector3, b: THREE.Vector3) => {
      const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
      const line = new THREE.Line(geo, lineMat);
      scene.add(line);
      lines.push(line);
    };

    for (let i = 0; i < NODES; i++) {
      addLine(new THREE.Vector3(0, 0, 0), nodeBase[i]);
    }
    for (let i = 0; i < NODES; i++) {
      addLine(nodeBase[i], nodeBase[(i + 1) % NODES]);
    }

    // ---------- 光晕 sprite ----------
    const glowCanvas = document.createElement("canvas");
    glowCanvas.width = glowCanvas.height = 128;
    const gctx = glowCanvas.getContext("2d")!;
    const grad = gctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(
      0,
      isDark ? "rgba(74, 222, 128, 0.5)" : "rgba(34, 197, 94, 0.3)",
    );
    grad.addColorStop(1, "rgba(34, 197, 94, 0)");
    gctx.fillStyle = grad;
    gctx.fillRect(0, 0, 128, 128);
    const glowTex = new THREE.CanvasTexture(glowCanvas);

    const glowMat = new THREE.SpriteMaterial({
      map: glowTex,
      transparent: true,
      opacity: isDark ? 0.45 : 0.28,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const nodeGlows: THREE.Sprite[] = [];
    for (const n of nodes) {
      const s = new THREE.Sprite(glowMat);
      s.scale.setScalar(1.5);
      s.position.copy(n.position);
      scene.add(s);
      nodeGlows.push(s);
    }
    const coreGlow = new THREE.Sprite(glowMat.clone());
    coreGlow.scale.setScalar(4.0);
    scene.add(coreGlow);

    // ---------- 动画：旋转 + 节点脉冲浮动 ----------
    let raf = 0;
    const start = performance.now();

    const animate = () => {
      const t = (performance.now() - start) / 1000;

      scene.rotation.y = t * 0.18;
      scene.rotation.x = Math.sin(t * 0.35) * 0.1;
      core.rotation.y = -t * 0.3;
      core.rotation.z = t * 0.12;

      for (let i = 0; i < NODES; i++) {
        const pulse = 1 + Math.sin(t * 1.6 + i * 1.3) * 0.18;
        nodes[i].scale.setScalar(pulse);
        nodeGlows[i].scale.setScalar(1.5 * pulse);
        labels[i].scale.set(0.9 * pulse, 0.25 * pulse, 1);
      }
      const corePulse = 1 + Math.sin(t * 1.2) * 0.08;
      core.scale.setScalar(corePulse);
      coreGlow.scale.setScalar(4.0 * corePulse);

      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    animate();

    // ---------- 自适应 ----------
    const onResize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    onResize();
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    // ---------- 清理 ----------
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      scene.traverse((obj) => {
        if (
          obj instanceof THREE.Mesh ||
          obj instanceof THREE.Line ||
          obj instanceof THREE.Sprite
        ) {
          obj.geometry?.dispose();
          const m = obj.material as THREE.Material | THREE.Material[];
          if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
          else m?.dispose();
        }
      });
      sphereTex.dispose();
      glowTex.dispose();
      labels.forEach((l) => {
        (l.material as THREE.SpriteMaterial).map?.dispose();
      });
    };
  }, [theme]);

  return <div ref={mountRef} className={className} aria-hidden />;
}
