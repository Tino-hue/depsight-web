// 发光按钮：主按钮带动态光晕扫过效果
// 来自 React Bits 的 ShinyButton，用 Tailwind + motion 实现
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

interface ShinyButtonProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  variant?: "solid" | "ghost";
  type?: "button" | "submit";
}

export function ShinyButton({
  children,
  className,
  onClick,
  variant = "solid",
  type = "button",
}: ShinyButtonProps) {
  if (variant === "ghost") {
    return (
      <motion.button
        type={type}
        onClick={onClick}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.97 }}
        className={cn(
          "group relative inline-flex cursor-pointer items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-full border border-primary/30 bg-primary/5 px-7 py-3 text-sm font-medium text-primary backdrop-blur-sm transition-all hover:border-primary/50 hover:bg-primary/10 hover:shadow-[0_0_24px_hsl(var(--primary)/0.2)]",
          className,
        )}
      >
        <span className="relative z-10 inline-flex items-center gap-2">
          {children}
        </span>
      </motion.button>
    );
  }

  return (
    <motion.button
      type={type}
      onClick={onClick}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      className={cn(
        "group relative inline-flex cursor-pointer items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-full bg-primary px-7 py-3 text-sm font-semibold text-primary-foreground shadow-[0_0_20px_hsl(var(--primary)/0.3)] transition-shadow hover:shadow-[0_0_40px_hsl(var(--primary)/0.5)]",
        className,
      )}
    >
      {/* 光晕扫过 */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden rounded-full"
      >
        <span className="absolute inset-0 rounded-full bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        <span className="absolute -left-full top-0 h-full w-full rounded-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-[200%]" />
      </span>
      <span className="relative z-10 inline-flex items-center gap-2">
        {children}
      </span>
    </motion.button>
  );
}
