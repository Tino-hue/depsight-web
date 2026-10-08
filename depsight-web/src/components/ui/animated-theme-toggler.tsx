// 动画主题切换按钮：圆形按钮，点击后太阳/月亮图标旋转互换
// 基于 framer-motion（motion）实现，来自 React Bits 的 AnimatedThemeToggler
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Sun, Moon } from "lucide-react";

import { cn } from "@/lib/utils";

interface AnimatedThemeTogglerProps {
  className?: string;
  /** 当前是否为深色模式 */
  isDark: boolean;
  /** 切换回调 */
  onToggle: () => void;
}

export function AnimatedThemeToggler({
  className,
  isDark,
  onToggle,
}: AnimatedThemeTogglerProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className={cn(
        "relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-secondary text-foreground transition-colors hover:bg-muted",
        className,
      )}
    >
      {mounted && (
        <AnimatePresence mode="wait" initial={false}>
          {isDark ? (
            <motion.span
              key="moon"
              initial={{ rotate: -90, opacity: 0, scale: 0.5 }}
              animate={{ rotate: 0, opacity: 1, scale: 1 }}
              exit={{ rotate: 90, opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
              className="inline-flex"
            >
              <Moon size={16} />
            </motion.span>
          ) : (
            <motion.span
              key="sun"
              initial={{ rotate: 90, opacity: 0, scale: 0.5 }}
              animate={{ rotate: 0, opacity: 1, scale: 1 }}
              exit={{ rotate: -90, opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
              className="inline-flex"
            >
              <Sun size={16} />
            </motion.span>
          )}
        </AnimatePresence>
      )}
    </button>
  );
}
