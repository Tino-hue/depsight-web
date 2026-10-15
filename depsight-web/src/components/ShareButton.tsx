// 分享按钮：把当前分析结果编码进 #share=<payload> 并复制链接
import { useEffect, useRef, useState } from "react";
import { Share2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useApp } from "@/state/AppContext";

export function ShareButton() {
  const { lastResult, copyShareUrl } = useApp();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const timerRef = useRef<number | null>(null);

  // 卸载时清理待触发的提示 timer，避免回写已卸载组件
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const onShare = async () => {
    const ok = await copyShareUrl();
    if (timerRef.current) clearTimeout(timerRef.current);
    if (ok) {
      setCopyError(false);
      setCopied(true);
      timerRef.current = window.setTimeout(() => setCopied(false), 1500);
    } else {
      // 复制失败反馈：与 copied 提示互斥，红色文案展示 2s
      setCopied(false);
      setCopyError(true);
      timerRef.current = window.setTimeout(() => setCopyError(false), 2000);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onShare}
      disabled={!lastResult}
      title={
        lastResult
          ? "Copy a share link for this analysis"
          : "Run an analysis first"
      }
    >
      <Share2 className="h-3.5 w-3.5" />
      {copyError ? (
        <span className="text-red-500">Copy failed</span>
      ) : copied ? (
        "Copied"
      ) : (
        "Share"
      )}
    </Button>
  );
}
