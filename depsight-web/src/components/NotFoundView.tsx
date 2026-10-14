// 404 未匹配视图：非法 hash 或未知路径（经 SPA fallback 进入）时展示
// 风格与 Hero 一致：纯黑底 + 品牌绿点缀
import { useApp } from "@/state/AppContext";
import { GlyphMatrix } from "@/components/ui/glyph-matrix";
import { ShinyButton } from "@/components/ui/shiny-button";

export function NotFoundView() {
  const { setView } = useApp();

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background">
      {/* 背景字符矩阵（同 Hero 的弱装饰层） */}
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <GlyphMatrix />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-6 px-6 text-center">
        <p className="font-mono text-sm tracking-widest text-primary/70 uppercase">
          404 — Not Found
        </p>
        <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-6xl">
          This page drifted out of orbit.
        </h1>
        <p className="max-w-md text-balance text-muted-foreground">
          The link you followed does not match any view in depsight. Head back
          home and scan your MoonBit dependencies instead.
        </p>
        <ShinyButton onClick={() => setView("hero")}>
          Back to depsight
        </ShinyButton>
      </div>
    </div>
  );
}
