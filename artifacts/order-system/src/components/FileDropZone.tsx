import { useRef, useEffect, useState } from "react";
import { Upload, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileDropZoneProps {
  onFile: (file: File) => void;
  accept?: string;
  disabled?: boolean;
  /** Pass true when the containing dialog is open so window-level listeners activate */
  dialogOpen?: boolean;
  className?: string;
  children?: React.ReactNode;
}

/**
 * A dashed-border drop zone that works inside Radix dialogs.
 *
 * Radix overlays intercept native drag events, so we attach window-level
 * dragover/dragleave/drop listeners when `dialogOpen` is true.
 *
 * Key fixes vs naïve implementation:
 *  - `e.preventDefault()` is always called in dragover (browser requires this to
 *    allow the drop event to fire — checking types first and returning early
 *    before calling it silently kills all drops).
 *  - `onFile` and `accept` are stored in refs so the effect never needs to
 *    re-run due to prop changes, avoiding constant listener re-attachment and
 *    stale-closure problems.
 *  - Drag counter tracks enter/leave properly across child elements.
 */
export function FileDropZone({
  onFile,
  accept,
  disabled,
  dialogOpen = true,
  className,
  children,
}: FileDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  // Keep latest props in refs so the effect closure never goes stale
  const onFileRef = useRef(onFile);
  const acceptRef = useRef(accept);
  const disabledRef = useRef(disabled);
  onFileRef.current = onFile;
  acceptRef.current = accept;
  disabledRef.current = disabled;

  useEffect(() => {
    if (!dialogOpen) return;

    let dragCounter = 0;

    const isFilesDrag = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).some(t => t.toLowerCase() === "files");

    const passesAccept = (file: File) => {
      const acc = acceptRef.current;
      if (!acc) return true;
      return acc.split(",").map(a => a.trim()).some(a => {
        if (a.startsWith(".")) return file.name.toLowerCase().endsWith(a.toLowerCase());
        if (a.endsWith("/*")) return file.type.startsWith(a.slice(0, -2));
        return file.type === a;
      });
    };

    const onDragEnter = (e: DragEvent) => {
      e.preventDefault();
      if (!isFilesDrag(e)) return;
      dragCounter++;
      setDragging(true);
    };

    const onDragOver = (e: DragEvent) => {
      // MUST always call preventDefault to allow the drop event to fire
      e.preventDefault();
      if (isFilesDrag(e)) setDragging(true);
    };

    const onDragLeave = (e: DragEvent) => {
      if (!isFilesDrag(e)) return;
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        setDragging(false);
      }
    };

    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounter = 0;
      setDragging(false);
      if (disabledRef.current) return;
      const file = e.dataTransfer?.files[0];
      if (file && passesAccept(file)) onFileRef.current(file);
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      dragCounter = 0;
      setDragging(false);
    };
  // Only re-run when the dialog opens/closes — props are read via refs
  }, [dialogOpen]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f && !disabledRef.current && passesAccept(f)) onFileRef.current(f);
    e.target.value = "";
  };

  return (
    <div
      onClick={() => !disabled && inputRef.current?.click()}
      className={cn(
        "flex flex-col items-center justify-center rounded-md border-2 border-dashed transition-colors",
        dragging
          ? "border-primary bg-primary/5"
          : "border-border hover:border-primary/50 hover:bg-muted/30",
        disabled ? "opacity-50 pointer-events-none" : "cursor-pointer",
        className,
      )}
    >
      {children}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        disabled={disabled}
        className="sr-only"
        onChange={handleInputChange}
      />
    </div>
  );
}

function passesAccept(file: File, accept?: string) {
  if (!accept) return true;
  return accept.split(",").map(a => a.trim()).some(a => {
    if (a.startsWith(".")) return file.name.toLowerCase().endsWith(a.toLowerCase());
    if (a.endsWith("/*")) return file.type.startsWith(a.slice(0, -2));
    return file.type === a;
  });
}

/** Convenience inner content for the standard "upload" state */
export function FileDropZoneContent({
  uploading,
  label = "Click or drag to upload",
  hint,
}: {
  uploading?: boolean;
  label?: string;
  hint?: string;
}) {
  return uploading ? (
    <>
      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mb-1" />
      <span className="text-xs text-muted-foreground">Uploading…</span>
    </>
  ) : (
    <>
      <Upload className="w-5 h-5 text-muted-foreground mb-1" />
      <span className="text-xs text-muted-foreground">{label}</span>
      {hint && <span className="text-[10px] text-muted-foreground/60 mt-0.5">{hint}</span>}
    </>
  );
}
