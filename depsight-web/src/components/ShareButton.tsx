// 分享按钮：把当前分析结果编码进 #share=<payload> 并复制链接
import { useState } from "react";
import { Share2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useApp } from "@/state/AppContext";

export function ShareButton() {
  const { lastResult, copyShareUrl } = useApp();
  const [copied, setCopied] = useState(false);

  const onShare = async () => {
    const ok = await copyShareUrl();
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
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
      {copied ? "Copied" : "Share"}
    </Button>
  );
}
