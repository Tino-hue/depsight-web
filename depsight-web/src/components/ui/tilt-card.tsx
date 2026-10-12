// TiltCard — spring-physics 3D tilt with a pointer-tracking glare, distilled
// from the React Bits "ProfileCard" interaction (holographic foil / contact
// chrome removed — only the tilt + glare + hover-lift core is kept).
//
// The engine writes CSS custom properties each frame; transforms come from
// variables so the spring animation never fights inline styles.
import { useEffect, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import "./tilt-card.css";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export interface TiltCardProps {
  /** Largest tilt angle in degrees. */
  tiltStrength?: number;
  /** Strength of the glare that follows the cursor (0..1). */
  glare?: number;
  /** How far the card lifts on hover, in px. */
  lift?: number;
  className?: string;
  children: ReactNode;
}

export default function TiltCard({
  tiltStrength = 10,
  glare = 0.45,
  lift = 6,
  className,
  children,
}: TiltCardProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef({ tiltStrength, glare, lift });
  settingsRef.current = { tiltStrength, glare, lift };

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Spring state for the tilt axes; `light` is the hover-activation level
    // (drives glare opacity and the hover lift).
    const x = { p: 0, v: 0, target: 0 };
    const y = { p: 0, v: 0, target: 0 };
    const light = { p: 0, target: 0 };
    let raf = 0;
    let last = performance.now();

    const write = () => {
      const { tiltStrength: strength, glare: g, lift: l } = settingsRef.current;
      const angle = reduced ? 0 : strength;
      const style = root.style;
      style.setProperty("--tc-rx", `${(y.p * angle).toFixed(3)}deg`);
      style.setProperty("--tc-ry", `${(-x.p * angle).toFixed(3)}deg`);
      style.setProperty("--tc-lift", `${(-light.p * (reduced ? 0 : l)).toFixed(2)}px`);
      style.setProperty("--tc-light-x", `${((x.p + 1) * 50).toFixed(2)}%`);
      style.setProperty("--tc-light-y", `${((y.p + 1) * 50).toFixed(2)}%`);
      style.setProperty("--tc-glare-o", (g * light.p).toFixed(4));
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000 || 0);
      last = now;
      // Semi-implicit Euler at a fixed 120 Hz substep — stable and framerate
      // independent.
      const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        for (const axis of [x, y]) {
          axis.v += (120 * (axis.target - axis.p) - 16 * axis.v) * h;
          axis.p += axis.v * h;
        }
      }
      light.p += (light.target - light.p) * (1 - Math.exp(-dt / 0.2));
      write();
      const moving =
        Math.abs(x.target - x.p) > 0.0005 ||
        Math.abs(y.target - y.p) > 0.0005 ||
        Math.abs(x.v) > 0.0005 ||
        Math.abs(y.v) > 0.0005 ||
        Math.abs(light.target - light.p) > 0.002;
      if (moving) {
        raf = requestAnimationFrame(frame);
      } else {
        // Settle exactly on the target and stop the loop (no idle rAF churn).
        x.p = x.target;
        y.p = y.target;
        light.p = light.target;
        write();
        raf = 0;
      }
    };

    const wake = () => {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };

    const aimAt = (event: PointerEvent) => {
      const rect = root.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      x.target = clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
      y.target = clamp(((event.clientY - rect.top) / rect.height) * 2 - 1, -1, 1);
      light.target = 1;
      wake();
    };
    const release = () => {
      x.target = 0;
      y.target = 0;
      light.target = 0;
      wake();
    };

    const onEnter = (event: PointerEvent) => {
      if (event.pointerType === "mouse") aimAt(event);
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "mouse") aimAt(event);
    };
    const onLeave = (event: PointerEvent) => {
      if (event.pointerType === "mouse") release();
    };

    root.addEventListener("pointerenter", onEnter);
    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerleave", onLeave);
    write();

    return () => {
      cancelAnimationFrame(raf);
      root.removeEventListener("pointerenter", onEnter);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className={cn("tilt-card liquid-glass text-card-foreground", className)}
    >
      {children}
      <span className="tilt-card__glare" aria-hidden />
    </div>
  );
}
