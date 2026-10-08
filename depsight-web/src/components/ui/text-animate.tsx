// 文字动画组件：支持按字符/单词逐段动画，多种进场效果
// 基于 motion 实现，来自 React Bits 的 TextAnimate
import { useMemo } from "react";
import { motion } from "motion/react";

import { cn } from "@/lib/utils";

type AnimationVariant =
  | "fadeIn"
  | "fadeInUp"
  | "fadeInDown"
  | "blurIn"
  | "blurInUp"
  | "blurInDown"
  | "scaleIn"
  | "slideInLeft"
  | "slideInRight";

interface TextAnimateProps {
  text: string;
  className?: string;
  variant?: AnimationVariant;
  /** 按字符还是按单词动画 */
  by?: "character" | "word";
  /** 每段延迟（秒） */
  delay?: number;
  /** 段间递延（秒） */
  stagger?: number;
  duration?: number;
  once?: boolean;
}

const variantPresets: Record<
  AnimationVariant,
  {
    hidden: Record<string, number | string>;
    visible: Record<string, number | string>;
  }
> = {
  fadeIn: { hidden: { opacity: 0 }, visible: { opacity: 1 } },
  fadeInUp: {
    hidden: { opacity: 0, y: 24 },
    visible: { opacity: 1, y: 0 },
  },
  fadeInDown: {
    hidden: { opacity: 0, y: -24 },
    visible: { opacity: 1, y: 0 },
  },
  blurIn: {
    hidden: { opacity: 0, filter: "blur(8px)" },
    visible: { opacity: 1, filter: "blur(0px)" },
  },
  blurInUp: {
    hidden: { opacity: 0, y: 16, filter: "blur(8px)" },
    visible: { opacity: 1, y: 0, filter: "blur(0px)" },
  },
  blurInDown: {
    hidden: { opacity: 0, y: -16, filter: "blur(8px)" },
    visible: { opacity: 1, y: 0, filter: "blur(0px)" },
  },
  scaleIn: {
    hidden: { opacity: 0, scale: 0.85 },
    visible: { opacity: 1, scale: 1 },
  },
  slideInLeft: {
    hidden: { opacity: 0, x: -32 },
    visible: { opacity: 1, x: 0 },
  },
  slideInRight: {
    hidden: { opacity: 0, x: 32 },
    visible: { opacity: 1, x: 0 },
  },
};

export function TextAnimate({
  text,
  className,
  variant = "blurInUp",
  by = "character",
  delay = 0,
  stagger = 0.03,
  duration = 0.6,
  once = true,
}: TextAnimateProps) {
  const segments = useMemo(
    () => (by === "word" ? text.split(" ") : Array.from(text)),
    [text, by],
  );

  const preset = variantPresets[variant];

  return (
    <motion.span
      className={cn("inline-block", className)}
      initial="hidden"
      whileInView="visible"
      viewport={{ once }}
      transition={{ staggerChildren: stagger, delayChildren: delay }}
    >
      {segments.map((seg, i) => (
        <motion.span
          key={`${seg}-${i}`}
          className="inline-block will-change-transform"
          variants={{
            hidden: preset.hidden,
            visible: {
              ...preset.visible,
              transition: { duration, ease: "easeOut" },
            },
          }}
        >
          {seg === " " ? "\u00A0" : seg}
          {by === "word" && i < segments.length - 1 ? "\u00A0" : ""}
        </motion.span>
      ))}
    </motion.span>
  );
}
