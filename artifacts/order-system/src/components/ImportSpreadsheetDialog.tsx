import { useState, useCallback, useRef, useEffect } from "react";
import * as XLSX from "xlsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileSpreadsheet, ArrowRight, ArrowLeft, Check, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) {
    const text = await res.text();
    let message = `HTTP ${res.status}`;
    try { const j = JSON.parse(text); if (j?.error) message = j.error; } catch {}
    throw new Error(message);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ─── Types ────────────────────────────────────────────────────────────────────

type ColumnType =
  | "skip"
  | "full_name"
  | "first_name"
  | "last_name"
  | "employee_number"
  | "job_title"
  | "email"
  | "phone"
  | "team"
  | "size"
  | "notes";

interface ColumnMapping {
  type: ColumnType;
  sizeLabel?: string;
}

interface ParsedSheet {
  rawRows: string[][];
  headers: string[];
}

interface MappedRow {
  firstName: string;
  lastName?: string;
  employeeNumber?: string;
  jobTitle?: string;
  email?: string;
  phone?: string;
  teamName?: string;
  notes?: string;
  sizes: { label: string; size: string }[];
}

interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; error: string }[];
}

type Step = "upload" | "map" | "preview" | "done";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const COLUMN_TYPE_LABELS: Record<ColumnType, string> = {
  skip: "(Skip)",
  full_name: "Full Name",
  first_name: "First Name",
  last_name: "Last Name",
  employee_number: "Employee No.",
  job_title: "Job Title",
  email: "Email",
  phone: "Phone",
  team: "Team",
  size: "Size (specify label →)",
  notes: "Notes",
};

function autoDetectType(header: string): ColumnType {
  const h = header.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (h.includes("firstname") || h === "first") return "first_name";
  if (h.includes("lastname") || h === "last" || h === "surname") return "last_name";
  if (h.includes("name") && !h.includes("team") && !h.includes("company")) return "full_name";
  if (h.includes("empno") || h.includes("employeeno") || h.includes("empnum") || h === "ref") return "employee_number";
  if (h.includes("jobtitle") || h.includes("title") || h.includes("position") || h.includes("role")) return "job_title";
  if (h.includes("email") || h.includes("mail")) return "email";
  if (h.includes("phone") || h.includes("tel") || h.includes("mobile")) return "phone";
  if (h.includes("team") || h.includes("dept") || h.includes("department") || h.includes("group")) return "team";
  if (h.includes("note") || h.includes("comment")) return "notes";
  return "skip";
}

function autoDetectSizeLabel(header: string): string {
  const clean = header.trim();
  if (!clean || clean.match(/^[a-z]$/i)) return "";
  return clean;
}

function colLetter(i: number): string {
  let s = "";
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function parseFile(file: File): Promise<ParsedSheet> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rawRows: string[][] = XLSX.utils.sheet_to_json(ws, {
          header: 1,
          defval: "",
          raw: false,
        }) as string[][];

        // Find first non-empty row to use as headers
        const firstNonEmpty = rawRows.find(r => r.some(c => String(c).trim()));
        const headers = (firstNonEmpty ?? []).map((c, i) => String(c).trim() || colLetter(i));
        resolve({ rawRows, headers });
      } catch (err: any) {
        reject(new Error("Could not read file. Make sure it is a valid Excel or CSV file."));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsArrayBuffer(file);
  });
}

function buildMappedRow(rawRow: string[], mappings: ColumnMapping[]): MappedRow | null {
  let firstName = "";
  let lastName: string | undefined;
  let employeeNumber: string | undefined;
  let jobTitle: string | undefined;
  let email: string | undefined;
  let phone: string | undefined;
  let teamName: string | undefined;
  let notes: string | undefined;
  const sizes: { label: string; size: string }[] = [];

  for (let i = 0; i < mappings.length; i++) {
    const val = String(rawRow[i] ?? "").trim();
    if (!val) continue;
    const m = mappings[i];
    switch (m.type) {
      case "full_name": {
        const parts = val.split(/\s+/);
        firstName = parts[0] ?? "";
        lastName = parts.slice(1).join(" ") || undefined;
        break;
      }
      case "first_name": firstName = val; break;
      case "last_name": lastName = val; break;
      case "employee_number": employeeNumber = val; break;
      case "job_title": jobTitle = val; break;
      case "email": email = val; break;
      case "phone": phone = val; break;
      case "team": teamName = val; break;
      case "notes": notes = val; break;
      case "size": {
        const label = m.sizeLabel?.trim() || `Size ${i + 1}`;
        sizes.push({ label, size: val });
        break;
      }
    }
  }

  if (!firstName) return null;
  return { firstName, lastName, employeeNumber, jobTitle, email, phone, teamName, notes, sizes };
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  customerId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
}

export function ImportSpreadsheetDialog({ customerId, open, onOpenChange, onImported }: Props) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [dragOver, setDragOver] = useState(false);
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [fileName, setFileName] = useState("");
  const [headerRowIndex, setHeaderRowIndex] = useState(0);
  const [dataStartIndex, setDataStartIndex] = useState(1);
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const reset = () => {
    setStep("upload");
    setSheet(null);
    setFileName("");
    setHeaderRowIndex(0);
    setDataStartIndex(1);
    setMappings([]);
    setResult(null);
    setLoading(false);
  };

  const handleClose = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const processFile = useCallback(async (file: File) => {
    setLoading(true);
    try {
      const parsed = await parseFile(file);
      setSheet(parsed);
      setFileName(file.name);

      // Detect header row: first row with content
      const hIdx = parsed.rawRows.findIndex(r => r.some(c => String(c).trim()));
      const hRow = hIdx >= 0 ? hIdx : 0;
      setHeaderRowIndex(hRow);
      setDataStartIndex(hRow + 1);

      // Auto-detect column types from header row
      const headers = parsed.rawRows[hRow] ?? [];
      const auto: ColumnMapping[] = headers.map((h) => {
        const hStr = String(h).trim();
        const type = autoDetectType(hStr);
        const sizeLabel = type === "size" ? autoDetectSizeLabel(hStr) : undefined;
        return { type, sizeLabel };
      });
      setMappings(auto);
      setStep("map");
    } catch (err: any) {
      toast({ title: "Error reading file", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = "";
  }, [processFile]);

  // The Radix Dialog overlay intercepts native drag events, so we attach
  // window-level listeners when the dialog is open and on the upload step.
  const dropZoneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || step !== "upload") return;
    const onDragOver = (e: DragEvent) => { e.preventDefault(); setDragOver(true); };
    const onDragLeave = (e: DragEvent) => {
      // Only clear when leaving the drop zone element itself
      if (dropZoneRef.current && !dropZoneRef.current.contains(e.relatedTarget as Node)) {
        setDragOver(false);
      }
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer?.files[0];
      if (file) processFile(file);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [open, step, processFile]);

  // Data rows based on current settings
  const headers = sheet ? (sheet.rawRows[headerRowIndex] ?? []).map((c, i) => String(c).trim() || colLetter(i)) : [];
  const dataRows = sheet ? sheet.rawRows.slice(dataStartIndex).filter(r => r.some(c => String(c).trim())) : [];
  const previewRows = dataRows.slice(0, 5);
  const mappedPreview = previewRows.map(r => buildMappedRow(r, mappings)).filter(Boolean) as MappedRow[];
  const totalDataRows = dataRows.length;
  const validMappedRows = dataRows.map(r => buildMappedRow(r, mappings)).filter(Boolean).length;

  const hasNameMapping = mappings.some(m => ["full_name", "first_name"].includes(m.type));

  const doImport = async () => {
    setLoading(true);
    try {
      const rows = dataRows
        .map(r => buildMappedRow(r, mappings))
        .filter(Boolean) as MappedRow[];

      const res = await apiFetch(`/customers/${customerId}/employees/import`, {
        method: "POST",
        body: JSON.stringify({ rows }),
      });
      setResult(res);
      setStep("done");
      onImported?.();
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[760px] max-h-[90vh] flex flex-col overflow-hidden p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/60 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-primary" />
            Import from Spreadsheet
          </DialogTitle>
          <DialogDescription className="mt-1">
            Upload an Excel or CSV file, map the columns, and import employees with their sizes.
          </DialogDescription>
          {/* Step indicators */}
          <div className="flex items-center gap-1.5 mt-3">
            {(["upload", "map", "preview", "done"] as Step[]).map((s, idx) => {
              const labels = ["1. Upload", "2. Map Columns", "3. Preview", "4. Done"];
              const stepIdx = ["upload", "map", "preview", "done"].indexOf(step);
              const isCurrent = s === step;
              const isDone = idx < stepIdx;
              return (
                <div key={s} className="flex items-center gap-1.5">
                  <span className={cn(
                    "text-xs font-medium px-2 py-0.5 rounded-full",
                    isCurrent ? "bg-primary text-white" : isDone ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
                  )}>
                    {labels[idx]}
                  </span>
                  {idx < 3 && <ArrowRight className="w-3 h-3 text-muted-foreground/40" />}
                </div>
              );
            })}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0">

          {/* ── Step 1: Upload ── */}
          {step === "upload" && (
            <div
              ref={dropZoneRef}
              className={cn(
                "border-2 border-dashed rounded-xl p-12 text-center transition-colors cursor-pointer",
                dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"
              )}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleFileChange}
              />
              {loading ? (
                <div className="flex flex-col items-center gap-3 text-muted-foreground">
                  <Loader2 className="w-10 h-10 animate-spin" />
                  <p className="text-sm font-medium">Reading file…</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 text-muted-foreground">
                  <Upload className="w-10 h-10 text-primary/50" />
                  <div>
                    <p className="font-medium text-foreground">Drop your spreadsheet here</p>
                    <p className="text-sm mt-0.5">or click to browse — .xlsx, .xls, .csv supported</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: Map Columns ── */}
          {step === "map" && sheet && (
            <div className="space-y-4">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <Label className="text-xs whitespace-nowrap">Header row</Label>
                  <Select
                    value={String(headerRowIndex)}
                    onValueChange={v => {
                      const idx = Number(v);
                      setHeaderRowIndex(idx);
                      setDataStartIndex(idx + 1);
                      const row = sheet.rawRows[idx] ?? [];
                      setMappings(row.map((h) => {
                        const hStr = String(h).trim();
                        const type = autoDetectType(hStr);
                        return { type, sizeLabel: type === "size" ? autoDetectSizeLabel(hStr) : undefined };
                      }));
                    }}
                  >
                    <SelectTrigger className="h-7 w-24 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {sheet.rawRows.slice(0, 10).map((_, i) => (
                        <SelectItem key={i} value={String(i)}>Row {i + 1}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs whitespace-nowrap">Data starts at row</Label>
                  <Select
                    value={String(dataStartIndex)}
                    onValueChange={v => setDataStartIndex(Number(v))}
                  >
                    <SelectTrigger className="h-7 w-24 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {sheet.rawRows.slice(0, 20).map((_, i) => (
                        <SelectItem key={i} value={String(i)}>Row {i + 1}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground ml-auto">
                  {fileName} — {totalDataRows} data rows detected
                </p>
              </div>

              {/* Column mapping table */}
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="grid bg-muted/40 border-b border-border px-3 py-2"
                  style={{ gridTemplateColumns: `80px 1fr 1fr 1fr` }}>
                  <span className="text-xs font-semibold text-muted-foreground">Col</span>
                  <span className="text-xs font-semibold text-muted-foreground">Spreadsheet Header</span>
                  <span className="text-xs font-semibold text-muted-foreground">Map to Field</span>
                  <span className="text-xs font-semibold text-muted-foreground">Size Label</span>
                </div>
                <div className="divide-y divide-border max-h-72 overflow-y-auto">
                  {headers.map((header, i) => (
                    <div key={i} className="grid items-center px-3 py-2 gap-2 hover:bg-muted/20"
                      style={{ gridTemplateColumns: `80px 1fr 1fr 1fr` }}>
                      <span className="text-xs font-mono text-muted-foreground">{colLetter(i)}</span>
                      <span className="text-xs font-medium truncate" title={header}>{header || <span className="text-muted-foreground/40">(blank)</span>}</span>
                      <Select
                        value={mappings[i]?.type ?? "skip"}
                        onValueChange={(v) => {
                          const next = [...mappings];
                          next[i] = { ...next[i], type: v as ColumnType };
                          if (v === "size" && !next[i].sizeLabel) {
                            next[i].sizeLabel = autoDetectSizeLabel(header) || header;
                          }
                          setMappings(next);
                        }}
                      >
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.entries(COLUMN_TYPE_LABELS) as [ColumnType, string][]).map(([t, label]) => (
                            <SelectItem key={t} value={t}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {mappings[i]?.type === "size" ? (
                        <Input
                          className="h-7 text-xs"
                          placeholder="e.g. Polo Shirt"
                          value={mappings[i]?.sizeLabel ?? ""}
                          onChange={e => {
                            const next = [...mappings];
                            next[i] = { ...next[i], sizeLabel: e.target.value };
                            setMappings(next);
                          }}
                        />
                      ) : (
                        <span />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {!hasNameMapping && (
                <p className="text-xs text-amber-600 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  Map at least one name column (Full Name or First Name) to continue.
                </p>
              )}
            </div>
          )}

          {/* ── Step 3: Preview ── */}
          {step === "preview" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Showing first {Math.min(5, mappedPreview.length)} of <strong>{validMappedRows}</strong> rows that will be imported.
                </p>
                <p className="text-xs text-muted-foreground">{totalDataRows - validMappedRows > 0 && `${totalDataRows - validMappedRows} row(s) skipped (no name)`}</p>
              </div>
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 border-b border-border">
                      <tr>
                        <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Name</th>
                        <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Team</th>
                        <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Email</th>
                        <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Sizes</th>
                        <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Other</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {mappedPreview.map((row, i) => (
                        <tr key={i} className="hover:bg-muted/20">
                          <td className="px-3 py-2 font-medium">
                            {[row.firstName, row.lastName].filter(Boolean).join(" ")}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{row.teamName || <span className="text-muted-foreground/40">—</span>}</td>
                          <td className="px-3 py-2 text-muted-foreground">{row.email || <span className="text-muted-foreground/40">—</span>}</td>
                          <td className="px-3 py-2">
                            {row.sizes.length > 0
                              ? <div className="flex flex-wrap gap-1">
                                  {row.sizes.map((s, si) => (
                                    <span key={si} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                                      {s.label}: <strong>{s.size}</strong>
                                    </span>
                                  ))}
                                </div>
                              : <span className="text-muted-foreground/40">—</span>
                            }
                          </td>
                          <td className="px-3 py-2 text-muted-foreground text-[11px]">
                            {[row.jobTitle, row.employeeNumber && `#${row.employeeNumber}`, row.notes].filter(Boolean).join(" · ") || <span className="text-muted-foreground/40">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-xs text-blue-700">
                Existing employees matched by name will be <strong>updated</strong>. New names will be <strong>created</strong>. Teams not yet in the system will be created automatically.
              </div>
            </div>
          )}

          {/* ── Step 4: Done ── */}
          {step === "done" && result && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-center">
                  <p className="text-2xl font-bold text-green-700">{result.created}</p>
                  <p className="text-xs text-green-600 mt-0.5 font-medium">Created</p>
                </div>
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-center">
                  <p className="text-2xl font-bold text-blue-700">{result.updated}</p>
                  <p className="text-xs text-blue-600 mt-0.5 font-medium">Updated</p>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-center">
                  <p className="text-2xl font-bold text-amber-700">{result.skipped}</p>
                  <p className="text-xs text-amber-600 mt-0.5 font-medium">Skipped (errors)</p>
                </div>
              </div>
              {result.errors.length > 0 && (
                <div className="border border-red-200 rounded-lg overflow-hidden">
                  <div className="bg-red-50 px-3 py-2 border-b border-red-200">
                    <p className="text-xs font-semibold text-red-700 flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5" /> {result.errors.length} row(s) had errors
                    </p>
                  </div>
                  <div className="max-h-40 overflow-y-auto divide-y divide-red-100">
                    {result.errors.map((e, i) => (
                      <div key={i} className="px-3 py-1.5 text-xs text-red-700">
                        <strong>Row {e.row}:</strong> {e.error}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {result.errors.length === 0 && (
                <div className="flex items-center gap-2 text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm">
                  <Check className="w-4 h-4" /> Import completed successfully — no errors.
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border/60 shrink-0 flex items-center justify-between">
          <div>
            {step !== "upload" && step !== "done" && (
              <Button variant="ghost" size="sm" onClick={() => setStep(step === "map" ? "upload" : "map")} className="gap-1.5">
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => handleClose(false)}>
              {step === "done" ? "Close" : "Cancel"}
            </Button>
            {step === "done" && (
              <Button onClick={reset} variant="outline">
                Import Another
              </Button>
            )}
            {step === "map" && (
              <Button onClick={() => setStep("preview")} disabled={!hasNameMapping} className="gap-1.5">
                Preview <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            )}
            {step === "preview" && (
              <Button onClick={doImport} disabled={loading || validMappedRows === 0} className="gap-1.5">
                {loading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Importing…</> : <><Check className="w-3.5 h-3.5" /> Import {validMappedRows} rows</>}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
