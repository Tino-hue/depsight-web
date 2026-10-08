// 字符矩阵背景：数字/符号不断随机变化的 canvas 动画
// 来自 React Bits 的 GlyphMatrix，支持主题色自适应
import { useEffect, useRef } from "react";

import { useApp } from "@/state/AppContext";
import { cn } from "@/lib/utils";

interface GlyphMatrixProps {
  className?: string;
  glyphs?: string;
  cellSize?: number;
  mutationRate?: number;
  interval?: number;
  fadeBottom?: number;
}

export function GlyphMatrix({
  className,
  glyphs = "01·•+*/\\<>= ",
  cellSize = 14,
  mutationRate = 0.04,
  interval = 90,
  fadeBottom = 0.6,
}: GlyphMatrixProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useApp();
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf: number;
    let lastTime = 0;
    let cols = 0;
    let rows = 0;
    let grid: string[][] = [];

    const chars = Array.from(glyphs);

    function resize() {
      const parent = canvas!.parentElement;
      if (!parent || !canvas || !ctx) return;
      const rect = parent.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      cols = Math.ceil(rect.width / cellSize);
      rows = Math.ceil(rect.height / cellSize);
      grid = Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () =>
          chars[Math.floor(Math.random() * chars.length)],
        ),
      );
    }

    function draw() {
      if (!canvas || !ctx) return;
      const rect = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);

      const dark = themeRef.current === "dark";
      const baseAlpha = dark ? 0.22 : 0.14;
      const highlightAlpha = dark ? 0.55 : 0.35;

      ctx.font = `${cellSize * 0.8}px ui-monospace, monospace`;
      ctx.textBaseline = "top";

      for (let y = 0; y < rows; y++) {
        // 底部渐隐
        const ratio = y / rows;
        const fade = ratio < fadeBottom ? 1 : 1 - (ratio - fadeBottom) / (1 - fadeBottom);
        const rowAlpha = Math.max(0, fade);

        for (let x = 0; x < cols; x++) {
          const isHot = Math.random() < mutationRate * 0.15;
          ctx.fillStyle = dark
            ? `hsla(119, 99%, ${isHot ? 60 : 40}%, ${isHot ? highlightAlpha * rowAlpha : baseAlpha * rowAlpha})`
            : `hsla(119, 60%, ${isHot ? 32 : 45}%, ${isHot ? highlightAlpha * rowAlpha : baseAlpha * rowAlpha})`;
          ctx.fillText(grid[y][x], x * cellSize, y * cellSize);
        }
      }
    }

    function mutate() {
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          if (Math.random() < mutationRate) {
            grid[y][x] = chars[Math.floor(Math.random() * chars.length)];
          }
        }
      }
    }

    function loop(time: number) {
      raf = requestAnimationFrame(loop);
      if (time - lastTime < interval) return;
      lastTime = time;
      mutate();
      draw();
    }

    resize();
    raf = requestAnimationFrame(loop);

    const ro = new ResizeObserver(() => resize());
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [glyphs, cellSize, mutationRate, interval, fadeBottom]);

  return (
    <canvas
      ref={canvasRef}
      className={cn("pointer-events-none absolute inset-0", className)}
      aria-hidden
    />
  );
}
