// 3D 力导向图渲染模块（Three.js）
// 节点大小 = 依赖影响力（children 数量 + self_size）
// 颜色 = 健康分（绿 ≥80 / 黄 ≥60 / 红 <60）
// 连线粗细 = 依赖紧深度（depth 越小越粗）

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

let scene, camera, renderer, controls;
let container;
let nodeGroup, edgeGroup; // 节点和连线的 Group
let nodeMeshes = []; // [{ mesh, node, health }]
let edgeLines = []; // [{ line, from, to }]
let highlightNodes = new Set();
let selectedNode = null;
let raycaster, mouse;
let animationId = null;
let pulseNodes = []; // 问题包（发光脉动）

// 初始化
export function initGraph3D(selector) {
  container = document.querySelector(selector);
  if (!container) return;

  const width = container.clientWidth;
  const height = container.clientHeight;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f1117);
  scene.fog = new THREE.Fog(0x0f1117, 200, 800);

  camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
  camera.position.set(0, 0, 120);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;

  // 光源
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambientLight);
  const pointLight = new THREE.PointLight(0xffffff, 1, 300);
  pointLight.position.set(50, 50, 50);
  scene.add(pointLight);
  const pointLight2 = new THREE.PointLight(0x6366f1, 0.5, 200);
  pointLight2.position.set(-50, -30, -50);
  scene.add(pointLight2);

  // Raycaster
  raycaster = new THREE.Raycaster();
  raycaster.params.Points = { threshold: 5 };
  mouse = new THREE.Vector2();

  // 事件
  renderer.domElement.addEventListener("click", onCanvasClick);
  renderer.domElement.addEventListener("mousemove", onCanvasMouseMove);
  window.addEventListener("resize", onWindowResize);

  // 动画循环
  animate();
}

// 更新数据
export function updateGraphData(graphData, analysisResult) {
  if (!scene) {
    console.log("[graph3d] scene not initialized");
    return;
  }

  // 清空旧数据
  clearGraph();

  if (!graphData || !graphData.nodes) {
    console.log("[graph3d] no graph data", graphData);
    return;
  }

  const { nodes, edges, root_id } = graphData;
  console.log(
    "[graph3d] updating with",
    nodes.length,
    "nodes,",
    edges.length,
    "edges",
  );
  const healthMap = new Map();
  const metaMap = new Map();

  if (analysisResult) {
    for (const h of analysisResult.health_scores || []) {
      healthMap.set(h.node_id, h);
    }
    for (const [id, m] of Object.entries(analysisResult.node_metas || {})) {
      metaMap.set(id, m);
    }
  }

  // 计算每个节点的 children 数量（用于决定大小）
  const childrenCount = new Map();
  for (const e of edges) {
    childrenCount.set(e.from, (childrenCount.get(e.from) || 0) + 1);
  }

  // 创建节点
  nodeGroup = new THREE.Group();
  const nodePositions = new Map();

  for (const node of nodes) {
    const health = healthMap.get(node.id);
    const meta = metaMap.get(node.id);
    const score = health ? health.total : 50;
    const childCount = childrenCount.get(node.id) || 0;
    const selfSize = meta?.self_size || 0;

    // 大小：基础半径 3 + children 加成 + size 加成
    const sizeBonus = Math.min(childCount * 0.3, 3);
    const sizeBonus2 =
      selfSize > 0 ? Math.min(Math.log10(selfSize / 1000 + 1), 3) : 0;
    const radius = 3 + sizeBonus + sizeBonus2;

    // 颜色：健康分
    const color = getHealthColor(score);

    // 位置：力导向（简化：按 depth 分层 + 随机散布）
    const pos = computeNodePosition(node, nodes.length);

    // 球体
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
    mesh.userData = { node, health: score, meta };

    nodeGroup.add(mesh);
    nodeMeshes.push({ mesh, node, health: score, meta });
    nodePositions.set(node.id, pos);

    // 问题包：score < 50 加入脉动列表
    if (score < 50) {
      pulseNodes.push({
        mesh,
        baseRadius: radius,
        phase: Math.random() * Math.PI * 2,
      });
    }

    // 标签（精灵）
    const label = createTextSprite(node.name.split("/").pop() || node.name);
    label.position.copy(pos).add(new THREE.Vector3(0, radius + 2, 0));
    nodeGroup.add(label);
  }

  scene.add(nodeGroup);

  // 创建边
  edgeGroup = new THREE.Group();
  for (const edge of edges) {
    const fromPos = nodePositions.get(edge.from);
    const toPos = nodePositions.get(edge.to);
    if (!fromPos || !toPos) continue;

    const depth = getNodeDepth(edge.from, nodes);
    const lineWidth = Math.max(1, 3 - depth * 0.5);

    const points = [fromPos, toPos];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: 0x3a4156,
      opacity: 0.4,
      transparent: true,
      linewidth: lineWidth,
    });
    const line = new THREE.Line(geometry, material);
    line.userData = { from: edge.from, to: edge.to };
    edgeGroup.add(line);
    edgeLines.push({ line, from: edge.from, to: edge.to });
  }
  scene.add(edgeGroup);

  // 调整相机视角
  fitCameraToGraph(nodes.length);
  console.log(
    "[graph3d] scene children:",
    scene.children.length,
    "nodeGroup:",
    nodeGroup?.children?.length,
    "edgeGroup:",
    edgeGroup?.children?.length,
  );
}

// 计算节点位置（简化力导向：按 depth 分层球面分布）
function computeNodePosition(node, totalNodes) {
  const depth = node.depth || 0;
  const angle = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);

  // 按 depth 缩放半径
  const baseRadius = 20 + depth * 25;
  const jitter = 0.7 + Math.random() * 0.6;

  const r = baseRadius * jitter;
  const x = r * Math.sin(phi) * Math.cos(angle);
  const y = r * Math.sin(phi) * Math.sin(angle);
  const z = r * Math.cos(phi);

  return new THREE.Vector3(x, y, z);
}

// 健康分对应颜色
function getHealthColor(score) {
  if (score >= 80) return new THREE.Color(0x10b981); // 绿
  if (score >= 60) return new THREE.Color(0xf59e0b); // 黄
  return new THREE.Color(0xef4444); // 红
}

// 创建文字精灵
function createTextSprite(text) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  canvas.width = 256;
  canvas.height = 64;

  ctx.fillStyle = "rgba(0,0,0,0)";
  ctx.fillRect(0, 0, 256, 64);

  ctx.font =
    'bold 28px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
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

// 调整相机视角
function fitCameraToGraph(nodeCount) {
  const dist = Math.max(80, nodeCount * 12);
  camera.position.set(dist * 0.6, dist * 0.4, dist);
  controls.target.set(0, 0, 0);
  controls.update();
}

// 获取节点 depth
function getNodeDepth(nodeId, nodes) {
  const n = nodes.find((n) => n.id === nodeId);
  return n ? n.depth : 0;
}

// 清空图
function clearGraph() {
  for (const { mesh } of nodeMeshes) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  for (const { line } of edgeLines) {
    scene.remove(line);
    line.geometry.dispose();
    line.material.dispose();
  }
  nodeMeshes = [];
  edgeLines = [];
  pulseNodes = [];
  highlightNodes.clear();
  selectedNode = null;
}

// 动画循环
let frameCount = 0;
function animate() {
  animationId = requestAnimationFrame(animate);
  frameCount++;
  if (frameCount === 1 || frameCount % 60 === 0) {
    console.log(
      "[graph3d] animate frame",
      frameCount,
      "scene children:",
      scene?.children?.length,
    );
  }

  // 脉动动画（问题包发光）
  const t = Date.now() * 0.003;
  for (const p of pulseNodes) {
    const s = 1 + 0.15 * Math.sin(t * 2 + p.phase);
    p.mesh.scale.setScalar(s);
    p.mesh.material.emissiveIntensity = 0.3 + 0.2 * Math.sin(t * 3 + p.phase);
  }

  // 高亮脉动
  for (const { mesh } of nodeMeshes) {
    if (highlightNodes.has(mesh.userData.node.id)) {
      mesh.material.emissiveIntensity = 0.5 + 0.3 * Math.sin(t * 4);
    }
  }

  controls.update();
  renderer.render(scene, camera);
}

// 点击事件
function onCanvasClick(event) {
  if (!container) return;
  const rect = container.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const meshes = nodeMeshes.map((n) => n.mesh);
  const intersects = raycaster.intersectObjects(meshes, false);

  if (intersects.length > 0) {
    const obj = intersects[0].object;
    const node = obj.userData.node;
    const health = obj.userData.health;
    const meta = obj.userData.meta;
    selectNode(node, health, meta);
  }
}

// 鼠标悬停
function onCanvasMouseMove(event) {
  if (!container) return;
  const rect = container.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const meshes = nodeMeshes.map((n) => n.mesh);
  const intersects = raycaster.intersectObjects(meshes, false);

  renderer.domElement.style.cursor = intersects.length > 0 ? "pointer" : "grab";
}

// 选中节点
function selectNode(node, health, meta) {
  selectedNode = node;

  // 高亮该节点的依赖路径
  highlightNodes.clear();
  highlightNodes.add(node.id);
  // 找父节点和子节点
  for (const { line } of edgeLines) {
    if (line.userData.from === node.id) highlightNodes.add(line.userData.to);
    if (line.userData.to === node.id) highlightNodes.add(line.userData.from);
  }

  // 显示详情面板
  const detailEl = document.querySelector("#graph-node-detail");
  if (detailEl) {
    detailEl.classList.remove("hidden");
    detailEl.innerHTML = renderNodeDetail(node, health, meta);
  }

  // 更新工具栏信息
  const infoEl = document.querySelector("#graph-selected-info");
  if (infoEl) {
    infoEl.textContent = `${node.name}@${node.version} · 健康分 ${health}`;
  }
}

// 渲染节点详情
function renderNodeDetail(node, health, meta) {
  const healthClass =
    health >= 80
      ? "gnd-health-good"
      : health >= 60
        ? "gnd-health-mid"
        : "gnd-health-bad";
  const healthLabel = health >= 80 ? "健康" : health >= 60 ? "警告" : "危险";
  return `
    <h4>${escapeHtml(node.id)}</h4>
    <div class="graph-node-detail-row">
      <span class="graph-node-detail-label">健康分</span>
      <span class="graph-node-detail-value ${healthClass}">${health} (${healthLabel})</span>
    </div>
    <div class="graph-node-detail-row">
      <span class="graph-node-detail-label">深度</span>
      <span class="graph-node-detail-value">${node.depth}</span>
    </div>
    ${
      meta
        ? `
    <div class="graph-node-detail-row">
      <span class="graph-node-detail-label">许可证</span>
      <span class="graph-node-detail-value">${escapeHtml(meta.license || "未声明")}</span>
    </div>
    <div class="graph-node-detail-row">
      <span class="graph-node-detail-label">最新版本</span>
      <span class="graph-node-detail-value">${escapeHtml(meta.latest_version || node.version)}</span>
    </div>
    <div class="graph-node-detail-row">
      <span class="graph-node-detail-label">体积</span>
      <span class="graph-node-detail-value">${formatBytes(meta.self_size || 0)}</span>
    </div>
    `
        : ""
    }
  `;
}

// 搜索定位
export function focusNode(nodeId) {
  if (!nodeId) return;
  const found = nodeMeshes.find(
    (n) => n.node.id === nodeId || n.node.name.includes(nodeId),
  );
  if (found) {
    selectNode(found.node, found.health, found.meta);
    // 相机聚焦
    const pos = found.mesh.position;
    controls.target.copy(pos);
    camera.position.set(pos.x + 30, pos.y + 20, pos.z + 40);
    controls.update();
  }
}

// 高亮依赖路径
export function highlightDependencyPath(fromId) {
  highlightNodes.clear();
  if (!fromId) return;

  // BFS 找从 fromId 出发的所有可达节点
  const visited = new Set([fromId]);
  const queue = [fromId];
  const adj = new Map();
  for (const { line } of edgeLines) {
    if (!adj.has(line.userData.from)) adj.set(line.userData.from, []);
    adj.get(line.userData.from).push(line.userData.to);
  }
  while (queue.length > 0) {
    const cur = queue.shift();
    highlightNodes.add(cur);
    for (const next of adj.get(cur) || []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
}

// 清除高亮
export function clearHighlights() {
  highlightNodes.clear();
  for (const { mesh } of nodeMeshes) {
    mesh.material.emissiveIntensity = 0.1;
  }
  const detailEl = document.querySelector("#graph-node-detail");
  if (detailEl) detailEl.classList.add("hidden");
  const infoEl = document.querySelector("#graph-selected-info");
  if (infoEl) infoEl.textContent = "";
}

// 窗口缩放
function onWindowResize() {
  if (!container || !camera || !renderer) return;
  const w = container.clientWidth;
  const h = container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

// 工具函数
function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

// 绑定搜索
export function bindGraphSearch(inputSelector) {
  const input = document.querySelector(inputSelector);
  if (!input) return;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const q = input.value.trim();
      if (q) focusNode(q);
    }
  });
}

// 绑定高亮按钮
export function bindHighlightButton(btnSelector, inputSelector) {
  const btn = document.querySelector(btnSelector);
  const input = document.querySelector(inputSelector);
  if (!btn || !input) return;
  btn.addEventListener("click", () => {
    const q = input.value.trim();
    if (q) {
      const found = nodeMeshes.find(
        (n) => n.node.id === q || n.node.name.includes(q),
      );
      if (found) highlightDependencyPath(found.node.id);
    }
  });
}
