import { useRef, useState } from "react";
import { Upload, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileDropZoneProps {
  onFile: (file: File) => void;
  accept?: string;
  disabled?: boolean;
  /** No longer needed — kept for API compatibility */
  dialogOpen?: boolean;
  className?: string;
  children?: React.ReactNode;
}

function passesAccept(file: File, accept?: string): boolean {
  if (!accept) return true;
  return accept.split(",").map(a => a.trim()).some(a => {
    if (a.startsWith(".")) return file.name.toLowerCase().endsWith(a.toLowerCase());
    if (a.endsWith("/*")) return file.type.startsWith(a.slice(0, -2));
    return file.type === a;
  });
}

/**
 * Drag-and-drop file zone that works inside Radix dialogs.
 *
 * Uses element-level drag handlers (not window-level). The DialogContent
 * sits above the Radix overlay in z-order so element events fire correctly.
 * A drag-counter handles enter/leave properly across child elements.
 */
export function FileDropZone({
  onFile,
  accept,
  disabled,
  className,
  children,
}: FileDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);

  // Keep latest callbacks in refs to avoid stale closures
  const onFileRef = useRef(onFile);
  onFileRef.current = onFile;
  const acceptRef = useRef(accept);
  acceptRef.current = accept;

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    setDragging(true);
  };

  const onDragOver = (e: React.DragEvent) => {
    // Must call preventDefault on every dragover to allow drop to fire
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragging(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setDragging(false);
    if (disabled) return;
    const file = e.dataTransfer.files[0];
    if (file && passesAccept(file, acceptRef.current)) {
      onFileRef.current(file);
    }
  };

  return (
    <div
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
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
          if (f && passesAccept(f, acceptRef.current)) onFileRef.current(f);
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
