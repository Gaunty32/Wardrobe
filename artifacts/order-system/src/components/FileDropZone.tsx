import { useRef, useEffect, useState, useCallback } from "react";
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
 * Radix overlays intercept native drag events, so we attach window-level
 * dragover/dragleave/drop listeners when `dialogOpen` is true.
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
  const zoneRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = useCallback(
    (file: File) => {
      if (disabled) return;
      if (accept) {
        const accepted = accept.split(",").map(a => a.trim());
        const ok = accepted.some(a => {
          if (a.startsWith(".")) return file.name.toLowerCase().endsWith(a.toLowerCase());
          if (a.endsWith("/*")) return file.type.startsWith(a.slice(0, -2));
          return file.type === a;
        });
        if (!ok) return;
      }
      onFile(file);
    },
    [onFile, accept, disabled],
  );

  useEffect(() => {
    if (!dialogOpen || disabled) return;

    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      setDragging(true);
    };
    const onDragLeave = (e: DragEvent) => {
      if (zoneRef.current && zoneRef.current.contains(e.relatedTarget as Node)) return;
      if (e.relatedTarget === null) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer?.files[0];
      if (file) handleFile(file);
    };

    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [dialogOpen, disabled, handleFile]);

  return (
    <div
      ref={zoneRef}
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
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
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
