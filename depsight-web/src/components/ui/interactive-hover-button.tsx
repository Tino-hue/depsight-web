// 悬停交互按钮：悬停时圆形图标展开，文字位移
// 来自 React Bits 的 InteractiveHoverButton
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";

/** 从 children 中提取纯文本（递归遍历 React 节点，忽略 SVG 等元素） */
function extractText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in node) {
    return extractText(
      (node as React.ReactElement<{ children?: React.ReactNode }>).props?.children,
    );
  }
  return "";
}

interface InteractiveHoverButtonProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  href?: string;
  target?: string;
  rel?: string;
}

export function InteractiveHoverButton({
  children,
  className,
  onClick,
  href,
  target,
  rel,
}: InteractiveHoverButtonProps) {
  const [hovered, setHovered] = useState(false);

  const inner = (
    <>
      {/* 默认文字状态 */}
      <span
        className={cn(
          "relative z-10 inline-flex items-center gap-2 transition-all duration-300",
          hovered
            ? "translate-x-[-8px] opacity-0"
            : "translate-x-0 opacity-100",
        )}
      >
        {children}
      </span>

      {/* 悬停状态：圆形 + 箭头 */}
      <AnimatePresence>
        {hovered && (
          <motion.span
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="absolute inset-0 z-10 inline-flex items-center justify-center gap-2 px-5"
          >
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <ArrowRight size={12} />
            </span>
            {/* 只取 children 中的纯文本（忽略 SVG 图标），避免图标重叠 */}
            <span className="text-sm font-medium">{extractText(children)}</span>
          </motion.span>
        )}
      </AnimatePresence>
    </>
  );

  const baseClass = cn(
    "group relative inline-flex cursor-pointer items-center justify-center overflow-hidden whitespace-nowrap rounded-full border border-border bg-transparent px-5 py-2 text-sm text-foreground transition-colors duration-200 hover:border-primary/50 hover:text-foreground",
    className,
  );

  if (href) {
    return (
      <a
        href={href}
        target={target}
        rel={rel}
        className={baseClass}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {inner}
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={baseClass}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {inner}
    </button>
  );
}
