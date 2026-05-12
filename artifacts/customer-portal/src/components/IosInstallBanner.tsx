import { useState, useEffect } from "react";
import { X, Share, Plus } from "lucide-react";

function isIosSafari(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  const isIos = /iphone|ipad|ipod/i.test(ua);
  const isSafari = /safari/i.test(ua) && !/crios|fxios|opios|edgios/i.test(ua);
  return isIos && isSafari;
}

function isInStandaloneMode(): boolean {
  return (
    ("standalone" in window.navigator && (window.navigator as any).standalone === true) ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}

const DISMISSED_KEY = "sbs_portal_install_banner_dismissed";

export default function IosInstallBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (
      isIosSafari() &&
      !isInStandaloneMode() &&
      !sessionStorage.getItem(DISMISSED_KEY)
    ) {
      setVisible(true);
    }
  }, []);

  function dismiss() {
    sessionStorage.setItem(DISMISSED_KEY, "1");
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 px-4 pb-6 pt-2 pointer-events-none">
      <div className="pointer-events-auto mx-auto max-w-sm rounded-2xl border border-border bg-card shadow-2xl p-4">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Plus className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-foreground text-sm font-semibold mb-0.5">Install this app</p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Tap{" "}
              <span className="inline-flex items-center gap-0.5 bg-muted rounded px-1 py-0.5 text-foreground">
                <Share className="w-3 h-3" />
              </span>
              {" "}then{" "}
              <span className="font-medium text-foreground">Add to Home Screen</span>
              {" "}for the best experience.
            </p>
          </div>
          <button
            onClick={dismiss}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0 mt-0.5"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 rotate-45 border-r border-b border-border bg-card" />
      </div>
    </div>
  );
}
