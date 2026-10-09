// Hero 落地页滚动区块：Features / How it works / Tech stack / Footer
// 样式集中 index.css 的 @layer components（.landing-*），深浅色经 CSS 变量适配
import { useEffect, useRef, useState } from "react";
import {
  Atom,
  Gauge,
  Layers,
  Moon,
  Network,
  Sparkles,
  Triangle,
  Wind,
} from "lucide-react";

import { Feature3D } from "@/components/Feature3D";
import { Card } from "@/components/ui/card";
import { useApp } from "@/state/AppContext";
import { cn } from "@/lib/utils";

const FOOTER_GITHUB_URL = "https://github.com/Tino-hue/depsight-web";

/** 滚动进场：IntersectionObserver 触发一次后保持可见 */
function Reveal({
  delay = 0,
  className,
  children,
}: {
  delay?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn("landing-reveal", visible && "is-visible", className)}
      style={{ "--d": `${delay}s` } as React.CSSProperties}
    >
      {children}
    </div>
  );
}

const FEATURES = [
  {
    icon: Layers,
    title: "Dependency Scanning",
    desc: "Parse moon.mod and scan every transitive dependency across mooncakes.io — versions, sources, and chains included.",
  },
  {
    icon: Network,
    title: "3D Dependency Graph",
    desc: "A Three.js force-directed graph lays your module tree out in space, so tangled dependency chains become visible.",
  },
  {
    icon: Gauge,
    title: "Health Scoring",
    desc: "Each module is scored across five dimensions: freshness, license, size, maintenance activity, and API stability.",
  },
  {
    icon: Sparkles,
    title: "AI Fix Suggestions",
    desc: "Risky packages are flagged with concrete upgrade or replacement suggestions you can act on immediately.",
  },
];

const STEPS = [
  {
    no: "01",
    title: "Paste or upload",
    desc: "Drop your moon.mod content into the analyzer or upload the file directly — no account, nothing leaves your machine.",
  },
  {
    no: "02",
    title: "Analyze locally",
    desc: "The MoonBit engine, compiled to WASM, parses the dependency graph and scores it right inside your browser.",
  },
  {
    no: "03",
    title: "Get the report",
    desc: "Receive a health report with risk-marked dependencies and AI-assisted fixes for your MoonBit stack.",
  },
];

const TECHS = [
  {
    icon: Moon,
    name: "MoonBit → WASM",
    desc: "Core analysis engine compiled to WebAssembly. Runs locally in the browser — no server required.",
  },
  {
    icon: Triangle,
    name: "Three.js",
    desc: "Powers the interactive 3D force-directed dependency graph.",
  },
  {
    icon: Atom,
    name: "React + TypeScript",
    desc: "Type-safe UI for reports, trends, and the ecosystem dashboard.",
  },
  {
    icon: Wind,
    name: "Tailwind CSS",
    desc: "Utility-first styling with a consistent dark / light design system.",
  },
];

function SectionHeading({
  eyebrow,
  title,
  sub,
}: {
  eyebrow: string;
  title: string;
  sub?: string;
}) {
  return (
    <div className="landing-heading">
      <Reveal>
        <span className="landing-eyebrow">{eyebrow}</span>
      </Reveal>
      <Reveal delay={0.08}>
        <h2 className="landing-title">{title}</h2>
      </Reveal>
      {sub && (
        <Reveal delay={0.16}>
          <p className="landing-sub">{sub}</p>
        </Reveal>
      )}
    </div>
  );
}

function FeaturesSection() {
  const { theme } = useApp();
  return (
    <section className="landing-section" id="features" aria-label="Features">
      <div className="landing-wrap">
        <div className="landing-features-layout">
          <div className="landing-features-copy">
            <SectionHeading
              eyebrow="Features"
              title="Everything your dependencies need"
              sub="From parsing moon.mod to scoring every package in the tree — depsight covers the full dependency health workflow."
            />
          </div>
          <div className="landing-features-3d">
            <Feature3D theme={theme} className="landing-3d-canvas" />
          </div>
        </div>
        <div className="landing-grid">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={0.08 * i}>
              <Card className="landing-card h-full">
                <span className="landing-card-icon">
                  <f.icon size={22} strokeWidth={1.7} aria-hidden />
                </span>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  return (
    <section
      className="landing-section"
      id="how-it-works"
      aria-label="How it works"
    >
      <div className="landing-wrap">
        <SectionHeading
          eyebrow="How it works"
          title="From moon.mod to health report"
          sub="Three steps, zero setup — the entire analysis pipeline runs on your machine."
        />
        <div className="landing-steps">
          {STEPS.map((s, i) => (
            <Reveal key={s.no} delay={0.1 * i}>
              <div className="landing-step">
                <span className="landing-step-no">{s.no}</span>
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function TechStackSection() {
  return (
    <section
      className="landing-section"
      id="tech-stack"
      aria-label="Tech stack"
    >
      <div className="landing-wrap">
        <SectionHeading
          eyebrow="Tech stack"
          title="Built on a lean, local-first stack"
        />
        <div className="landing-tech">
          {TECHS.map((t, i) => (
            <Reveal key={t.name} delay={0.08 * i}>
              <Card className="landing-tech-card h-full">
                <span className="landing-tech-logo">
                  <t.icon size={24} strokeWidth={1.6} aria-hidden />
                </span>
                <h3>{t.name}</h3>
                <p>{t.desc}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function LandingFooter() {
  return (
    <footer className="landing-footer">
      <div className="landing-footer-inner">
        <a
          href={FOOTER_GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          className="landing-footer-link"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden
          >
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
          </svg>
          GitHub
        </a>
        <span className="landing-footer-brand">
          depsight<span className="landing-footer-dot">.</span>
        </span>
        <span>© 2026 XiaoRuoyu</span>
      </div>
    </footer>
  );
}

/** Hero 首屏下方的全部滚动区块 */
export function LandingSections() {
  return (
    <div className="landing">
      <FeaturesSection />
      <HowItWorksSection />
      <TechStackSection />
      <LandingFooter />
    </div>
  );
}
