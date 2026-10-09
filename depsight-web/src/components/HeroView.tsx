// 落地首页：depsight 品牌 Hero
// 版式借鉴单视口 landing：垂直居中 copy、WarpText 液态扭曲、三统计栏
// 风格：纯黑底 + 品牌绿点缀，全英文
import { useEffect, useRef } from "react";

import { useApp } from "@/state/AppContext";
import { cn } from "@/lib/utils";
import { LandingSections } from "@/components/LandingSections";
import { WarpText } from "@/components/ui/warp-text";
import { ShinyButton } from "@/components/ui/shiny-button";
import { InteractiveHoverButton } from "@/components/ui/interactive-hover-button";
import { GlyphMatrix } from "@/components/ui/glyph-matrix";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";

const GITHUB_URL = "https://github.com/peterzhao2008/depsight";

/** 进场动画枚举（与 CSS keyframes 对应） */
type AppearVariant = "pop" | "soft" | "btn" | "side" | "stat";

interface AppearProps {
  variant: AppearVariant;
  delay: number; // 秒
  className?: string;
  children: React.ReactNode;
}

/** 包装进场动画：animationend 后加 .is-in 清除合成器成本 */
function Appear({ variant, delay, className, children }: AppearProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onEnd = () => el.classList.add("is-in");
    el.addEventListener("animationend", onEnd, { once: true });
    return () => el.removeEventListener("animationend", onEnd);
  }, []);

  return (
    <div
      ref={ref}
      className={cn("hero-appear", `appear--${variant}`, className)}
      style={{ "--d": `${delay}s` } as React.CSSProperties}
    >
      {children}
    </div>
  );
}

const STATS = [
  {
    label: "modules scanned across mooncakes.io",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
        <rect
          x="3.4"
          y="2.6"
          width="7.2"
          height="18.8"
          rx="3.6"
          fill="url(#sg1)"
        />
        <rect
          x="13.4"
          y="2.6"
          width="7.2"
          height="18.8"
          rx="3.6"
          fill="url(#sg2)"
        />
        <rect
          x="9.2"
          y="10.9"
          width="5.6"
          height="2.2"
          rx="1.1"
          fill="#4a4a4a"
        />
        <defs>
          <linearGradient id="sg1" x1="3" y1="2" x2="14" y2="22">
            <stop stopColor="hsl(119 99% 46% / .4)" />
            <stop offset="1" stopColor="hsl(119 99% 46% / .62)" />
          </linearGradient>
          <linearGradient id="sg2" x1="3" y1="2" x2="14" y2="22">
            <stop stopColor="hsl(119 99% 46% / .62)" />
            <stop offset="1" stopColor="hsl(119 99% 46% / .4)" />
          </linearGradient>
        </defs>
      </svg>
    ),
  },
  {
    label: "dependency graph rendered in 3D",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
        <circle cx="6" cy="6" r="3" fill="hsl(119 99% 46% / .8)" />
        <circle cx="18" cy="7" r="2.4" fill="hsl(119 99% 46% / .55)" />
        <circle cx="12" cy="17" r="2.8" fill="hsl(119 99% 46% / .95)" />
        <path
          d="M8.3 7.4 15.8 7M7 8.8l3.6 5.8M16.6 9.2l-3 5.6"
          stroke="#5a5a5a"
          strokeWidth="1.2"
        />
      </svg>
    ),
  },
  {
    label: "health dimensions scored per module",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
        <path
          d="M12 3a9 9 0 1 0 9 9"
          stroke="#5a5a5a"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M12 3a9 9 0 0 1 9 9"
          stroke="hsl(119 99% 46%)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="12" cy="12" r="2" fill="hsl(119 99% 46%)" />
      </svg>
    ),
  },
];

export function HeroView() {
  const { setView, wasmStatus, theme, toggleTheme } = useApp();

  // 动画兜底：两帧后若未运行则强制 is-in，保证不空白
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document
          .querySelectorAll<HTMLElement>(".hero-appear:not(.is-in)")
          .forEach((el) => {
            const anims = el.getAnimations();
            if (
              !anims.some(
                (a) => a.playState === "running" || a.playState === "finished",
              )
            ) {
              el.classList.add("is-in");
            }
          });
      });
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const startDiagnosis = () => setView("analyze");
  const seeGraph = () => setView("graph");

  return (
    <div className="hero-root">
      {/* GlyphMatrix 字符矩阵背景 */}
      <div className="hero-scan" aria-hidden>
        <GlyphMatrix
          glyphs="01·•+*/\\<>= "
          cellSize={14}
          mutationRate={0.04}
          interval={90}
          fadeBottom={0.6}
        />
      </div>

      <div className="hero-page">
        <header className="hero-header">
          {/* 左：logo */}
          <a
            href="#hero"
            className="hero-logo"
            aria-label="depsight home"
            onClick={(e) => {
              e.preventDefault();
              setView("hero");
            }}
          >
            <svg
              viewBox="0 0 24 24"
              width="22"
              height="22"
              fill="currentColor"
              aria-hidden
            >
              <g transform="rotate(-30 12 12)">
                <circle cx="7.3" cy="3.2" r="1.45" />
                <rect x="5.5" y="4.7" width="3.6" height="14.6" rx="1.8" />
                <rect x="14.9" y="4.7" width="3.6" height="14.6" rx="1.8" />
                <circle cx="16.7" cy="20.8" r="1.45" />
              </g>
            </svg>
            <span>
              depsight<span className="hero-logo-dot">.</span>
            </span>
          </a>

          {/* 右：主题切换 + GitHub */}
          <div className="hero-header-right">
            <AnimatedThemeToggler
              isDark={theme === "dark"}
              onToggle={toggleTheme}
            />
            <Appear variant="soft" delay={0.34}>
              <InteractiveHoverButton
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                className="hero-github-btn !min-w-[120px]"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  aria-hidden
                  style={{ marginRight: 4 }}
                >
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
                </svg>
                GitHub
              </InteractiveHoverButton>
            </Appear>
          </div>
        </header>

        <main className="hero" id="hero">
          <div className="hero-copy">
            <Appear variant="pop" delay={0.22}>
              <div className="hero-badge">
                <svg
                  className="hero-badge-star"
                  viewBox="0 0 24 24"
                  width="18"
                  height="20"
                  fill="currentColor"
                  aria-hidden
                >
                  <path d="M12 2.6C12.55 2.6 12.88 3.15 13.08 4.7c.62 4.7 1.52 5.6 6.22 6.22 1.55.2 2.1.53 2.1 1.08s-.55.88-2.1 1.08c-4.7.62-5.6 1.52-6.22 6.22-.2 1.55-.53 2.1-1.08 2.1s-.88-.55-1.08-2.1c-.62-4.7-1.52-5.6-6.22-6.22C3.15 12.88 2.6 12.55 2.6 12s.55-.88 2.1-1.08c4.7-.62 5.6-1.52 6.22-6.22C11.12 3.15 11.45 2.6 12 2.6Z" />
                </svg>
                <span>MoonBit Dependency Intelligence</span>
              </div>
            </Appear>

            {/* H1：WarpText WebGL 液态扭曲悬停效果 */}
            <h1 className="hero-h1">
              <WarpText
                text={"Scan dependency risk\nacross your MoonBit stack."}
                color={theme === "dark" ? "#ffffff" : "#1a1f2e"}
                warpStrength={0.1}
                warpScale={1.8}
                speed={0.5}
                pointerInfluence={0.45}
                pointerStrength={0.42}
                refraction={0.02}
                ripple={true}
                fontSize="clamp(2.5rem, 6vw, 5.5rem)"
                fontWeight={500}
                fontFamily="Sora, system-ui, sans-serif"
                letterSpacing="-0.04em"
                lineHeight={1.1}
                style={{ height: "clamp(180px, 30vw, 320px)" }}
              />
            </h1>

            <Appear variant="soft" delay={0.95}>
              <p className="hero-lede">
                depsight turns a moon.mod into a health report: dependency
                graphs, license and freshness signals, and AI-assisted fixes —
                before a stale package reaches production.
              </p>
            </Appear>

            <div className="hero-actions">
              <Appear variant="btn" delay={1.1}>
                <ShinyButton onClick={startDiagnosis}>
                  Start Diagnosis
                  <svg
                    viewBox="0 0 24 24"
                    width="15"
                    height="15"
                    fill="none"
                    aria-hidden
                  >
                    <path
                      d="M5 12h14M13 6l6 6-6 6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </ShinyButton>
              </Appear>
              <Appear variant="side" delay={1.24}>
                <ShinyButton variant="ghost" onClick={seeGraph}>
                  See the 3D graph
                </ShinyButton>
              </Appear>
            </div>
          </div>
        </main>

        <footer className="hero-stats">
          {STATS.map((s, i) => (
            <Appear key={s.label} variant="stat" delay={1.3 + i * 0.16}>
              <div className="hero-stat">
                <span className="hero-stat-icon">{s.icon}</span>
                <span>{s.label}</span>
              </div>
            </Appear>
          ))}
          <span className="hero-wasm">
            {wasmStatus === "loaded"
              ? "WASM ready"
              : wasmStatus === "loading"
                ? "WASM loading"
                : "JS fallback"}
          </span>
        </footer>
      </div>

      {/* 首屏下方：滚动落地区块（Features / How it works / Tech stack / Footer） */}
      <LandingSections />
    </div>
  );
}
