import { useState, useEffect, useCallback } from "react";
import { Printer, CheckCircle, AlertTriangle, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

const API_BASE = "/api";

interface LabelData {
  orderNumber: string;
  customerName: string;
  shippingMethod: string;
  isDpd: boolean;
  trackingNumber: string | null;
  poNumber: string | null;
  contactName: string | null;
  phone: string | null;
  addressLines: string[];
  wearers: Array<{
    name: string;
    jobTitle: string | null;
    items: Array<{
      productName: string;
      colour: string | null;
      size: string | null;
      quantity: number;
      finishName: string | null;
    }>;
  }>;
}

// ── ZPL helpers (4×3 in = 812×609 dots at 203dpi) ───────────────────────────
// Origin 0,0 is top-left. All coordinates in dots.

function zplEscape(s: string): string {
  return s.replace(/[\\^~]/g, " ").replace(/[^\x20-\x7E]/g, "?");
}

// Wrap text to maxWidth chars
function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length <= maxChars) {
      current = (current + " " + word).trim();
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function buildBoxLabelZpl(data: LabelData): string {
  const W = 812; // 4 in @ 203 dpi
  const H = 609; // 3 in @ 203 dpi
  const lines: string[] = [];
  lines.push("^XA");
  lines.push(`^PW${W}^LL${H}^LH0,0`);

  // Header bar — order number right, "BOX LABEL" left
  lines.push("^FO20,10^A0N,22,22^FDBOX LABEL^FS");
  lines.push(`^FO${W - 20},10^A0N,22,22^FB200,1,0,R^FD${zplEscape(data.orderNumber)}^FS`);
  // Header underline
  lines.push(`^FO0,40^GB${W},2,2^FS`);

  // Customer name
  lines.push(`^FO20,50^A0N,44,44^FD${zplEscape(data.customerName.slice(0, 28))}^FS`);
  // Divider under customer
  lines.push(`^FO0,104^GB${W},2,2^FS`);

  let y = 114;
  const KEY_W = 160;
  const addRow = (key: string, val: string) => {
    lines.push(`^FO20,${y}^A0N,20,20^FD${zplEscape(key.toUpperCase())}^FS`);
    lines.push(`^FO${KEY_W},${y}^A0N,24,24^FD${zplEscape(val.slice(0, 35))}^FS`);
    y += 34;
  };

  addRow("Delivery", data.shippingMethod);
  if (data.isDpd && data.trackingNumber) addRow("DPD", data.trackingNumber);
  if (data.poNumber) addRow("PO Ref", data.poNumber);
  if (data.contactName) addRow("Contact", data.contactName);
  if (data.phone) addRow("Phone", data.phone);

  // Address block
  if (data.addressLines.length > 0) {
    y += 4;
    for (const line of data.addressLines.slice(0, 5)) {
      lines.push(`^FO20,${y}^A0N,22,22^FD${zplEscape(line)}^FS`);
      y += 28;
    }
  }

  lines.push("^XZ");
  return lines.join("\n");
}

function buildWearerLabelZpl(
  data: LabelData,
  wearer: LabelData["wearers"][0],
): string {
  const W = 812;
  const H = 609;
  const lines: string[] = [];
  lines.push("^XA");
  lines.push(`^PW${W}^LL${H}^LH0,0`);

  // Wearer name — large but capped
  const nameStr = zplEscape(wearer.name.slice(0, 30));
  lines.push(`^FO20,12^A0N,48,48^FD${nameStr}^FS`);
  if (wearer.jobTitle) {
    lines.push(`^FO20,68^A0N,22,22^FD${zplEscape(wearer.jobTitle.slice(0, 45))}^FS`);
  }
  // Divider under name
  lines.push(`^FO0,${wearer.jobTitle ? 96 : 68}^GB${W},2,2^FS`);

  // Column headers
  let y = wearer.jobTitle ? 104 : 76;
  lines.push(`^FO20,${y}^A0N,16,16^FDITEM^FS`);
  lines.push(`^FO370,${y}^A0N,16,16^FDCOLOUR^FS`);
  lines.push(`^FO520,${y}^A0N,16,16^FDSIZE^FS`);
  lines.push(`^FO650,${y}^A0N,16,16^FDQTY^FS`);
  y += 22;
  lines.push(`^FO0,${y}^GB${W},1,1^FS`);
  y += 4;

  for (const item of wearer.items.slice(0, 8)) {
    const nameLines = wrapText(item.productName, 28);
    lines.push(`^FO20,${y}^A0N,20,20^FD${zplEscape(nameLines[0])}^FS`);
    if (item.finishName) {
      lines.push(`^FO20,${y + 22}^A0N,16,16^FD${zplEscape(item.finishName.slice(0, 32))}^FS`);
    }
    if (item.colour) lines.push(`^FO370,${y}^A0N,20,20^FD${zplEscape(item.colour.slice(0, 12))}^FS`);
    if (item.size)   lines.push(`^FO520,${y}^A0N,20,20^FD${zplEscape(item.size.slice(0, 8))}^FS`);
    lines.push(`^FO650,${y}^A0N,22,22^FD${item.quantity}^FS`);
    const rowH = item.finishName ? 44 : 28;
    y += rowH;
    lines.push(`^FO0,${y}^GB${W},1,1^FS`);
    y += 2;
    if (y > H - 40) break;
  }

  // Footer
  lines.push(`^FO20,${H - 30}^A0N,20,20^FD${zplEscape(data.customerName)}^FS`);
  lines.push(`^FO${W - 20},${H - 30}^A0N,20,20^FB150,1,0,R^FD${zplEscape(data.orderNumber)}^FS`);

  lines.push("^XZ");
  return lines.join("\n");
}

// ── Zebra Browser Print bridge ───────────────────────────────────────────────

declare global {
  interface Window {
    BrowserPrint?: {
      getDefaultDevice(
        type: string,
        success: (device: ZebraDevice) => void,
        error: (err: string) => void,
      ): void;
      getLocalDevices(
        success: (devices: ZebraDevice[]) => void,
        error: (err: string) => void,
        type?: string,
      ): void;
    };
  }
}

interface ZebraDevice {
  name: string;
  uid: string;
  send(data: string, success?: () => void, error?: (err: string) => void): void;
}

function loadBrowserPrintScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.BrowserPrint) { resolve(); return; }
    const existing = document.getElementById("zebra-browser-print-sdk");
    if (existing) { existing.addEventListener("load", () => resolve()); return; }
    const script = document.createElement("script");
    script.id = "zebra-browser-print-sdk";
    script.src = "http://127.0.0.1:9100/BrowserPrint-3.1.250.min.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Zebra Browser Print not found at localhost:9100. Is the app installed and running?"));
    document.head.appendChild(script);
  });
}

function sendZpl(device: ZebraDevice, zpl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    device.send(zpl, resolve, reject);
  });
}

function getDefaultPrinter(): Promise<ZebraDevice> {
  return new Promise((resolve, reject) => {
    window.BrowserPrint!.getDefaultDevice("printer", resolve, reject);
  });
}

function getAllPrinters(): Promise<ZebraDevice[]> {
  return new Promise((resolve, reject) => {
    window.BrowserPrint!.getLocalDevices((devices) => resolve(devices ?? []), reject, "printer");
  });
}

// ── Main component ────────────────────────────────────────────────────────────

interface ZebraLabelsProps {
  orderId: number;
  orderNumber: string;
  hasNamedRecipients: boolean;
}

type PrinterStatus = "idle" | "loading" | "ready" | "printing" | "done" | "error";

export default function ZebraLabels({ orderId, orderNumber, hasNamedRecipients }: ZebraLabelsProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<PrinterStatus>("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [printer, setPrinter] = useState<ZebraDevice | null>(null);
  const [allPrinters, setAllPrinters] = useState<ZebraDevice[]>([]);
  const [labelData, setLabelData] = useState<LabelData | null>(null);
  const [printQueue, setPrintQueue] = useState<string[]>([]);
  const [printedCount, setPrintedCount] = useState(0);

  const connectPrinter = useCallback(async () => {
    setStatus("loading");
    setStatusMsg("Connecting to Zebra Browser Print…");
    try {
      await loadBrowserPrintScript();
      const [printers, defaultDevice] = await Promise.all([
        getAllPrinters().catch(() => [] as ZebraDevice[]),
        getDefaultPrinter().catch(() => null as ZebraDevice | null),
      ]);
      const available = printers.length > 0 ? printers : (defaultDevice ? [defaultDevice] : []);
      if (available.length === 0) throw new Error("No Zebra printers found.");
      setAllPrinters(available);
      setPrinter(defaultDevice ?? available[0]);

      const resp = await fetch(`${API_BASE}/orders/${orderId}/label-data`);
      if (!resp.ok) throw new Error(await resp.text());
      const data: LabelData = await resp.json();
      setLabelData(data);
      setStatus("ready");
      setStatusMsg(`Connected to ${(defaultDevice ?? available[0]).name}`);
    } catch (err: unknown) {
      setStatus("error");
      setStatusMsg(err instanceof Error ? err.message : String(err));
    }
  }, [orderId]);

  useEffect(() => {
    if (open) connectPrinter();
    else { setStatus("idle"); setPrinter(null); setLabelData(null); setPrintQueue([]); setPrintedCount(0); }
  }, [open, connectPrinter]);

  async function printAll() {
    if (!printer || !labelData) return;
    setStatus("printing");
    const jobs: string[] = [];
    jobs.push(buildBoxLabelZpl(labelData));
    for (const wearer of labelData.wearers) {
      jobs.push(buildWearerLabelZpl(labelData, wearer));
    }
    setPrintQueue(jobs.map((_, i) => i === 0 ? "Box label" : `Wearer: ${labelData.wearers[i - 1].name}`));
    let printed = 0;
    for (const zpl of jobs) {
      try {
        await sendZpl(printer, zpl);
        printed++;
        setPrintedCount(printed);
      } catch (err) {
        setStatus("error");
        setStatusMsg(`Print failed on job ${printed + 1}: ${err}`);
        return;
      }
    }
    setStatus("done");
    setStatusMsg(`Printed ${printed} label${printed !== 1 ? "s" : ""}`);
  }

  async function printBoxOnly() {
    if (!printer || !labelData) return;
    setStatus("printing");
    try {
      await sendZpl(printer, buildBoxLabelZpl(labelData));
      setStatus("done");
      setStatusMsg("Box label printed");
    } catch (err) {
      setStatus("error");
      setStatusMsg(`Print failed: ${err}`);
    }
  }

  async function printWearer(wearer: LabelData["wearers"][0]) {
    if (!printer || !labelData) return;
    setStatus("printing");
    try {
      await sendZpl(printer, buildWearerLabelZpl(labelData, wearer));
      setStatus("done");
      setStatusMsg(`Printed: ${wearer.name}`);
    } catch (err) {
      setStatus("error");
      setStatusMsg(`Print failed: ${err}`);
    }
  }

  const isbusy = status === "loading" || status === "printing";

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5 text-xs"
        onClick={() => setOpen(true)}
      >
        <Printer className="w-3.5 h-3.5" /> Labels
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Printer className="w-5 h-5" /> Print Labels — {orderNumber}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* Printer status */}
            <div className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm ${
              status === "error" ? "border-red-200 bg-red-50 text-red-700" :
              status === "ready" || status === "done" ? "border-green-200 bg-green-50 text-green-700" :
              "border-border bg-muted/30 text-muted-foreground"
            }`}>
              {status === "loading" && <RefreshCw className="w-4 h-4 animate-spin flex-shrink-0" />}
              {(status === "ready" || status === "done") && <CheckCircle className="w-4 h-4 flex-shrink-0" />}
              {status === "error" && <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
              {status === "printing" && <RefreshCw className="w-4 h-4 animate-spin flex-shrink-0" />}
              {status === "idle" && <Printer className="w-4 h-4 flex-shrink-0" />}
              <span className="flex-1 min-w-0">{statusMsg || "Initialising…"}</span>
              {status === "error" && (
                <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={connectPrinter}>Retry</Button>
              )}
            </div>

            {status === "error" && statusMsg.includes("not found") && (
              <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2.5 text-xs text-blue-800 space-y-1">
                <p className="font-semibold">Zebra Browser Print not detected</p>
                <p>Download and install from <a href="https://www.zebra.com/us/en/software/printer-software/browser-print.html" target="_blank" rel="noopener" className="underline">zebra.com</a>, then click Retry.</p>
              </div>
            )}

            {/* Printer selector */}
            {allPrinters.length > 1 && printer && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground font-medium">Printer</label>
                <select
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                  value={printer.uid}
                  onChange={(e) => {
                    const p = allPrinters.find(d => d.uid === e.target.value);
                    if (p) setPrinter(p);
                  }}
                >
                  {allPrinters.map(p => <option key={p.uid} value={p.uid}>{p.name}</option>)}
                </select>
              </div>
            )}

            {/* Print actions */}
            {(status === "ready" || status === "done") && labelData && (
              <div className="space-y-3">
                {/* Box label */}
                <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-border bg-card">
                  <div>
                    <p className="text-sm font-medium">Box Label</p>
                    <p className="text-xs text-muted-foreground">{labelData.customerName} · {labelData.shippingMethod}</p>
                  </div>
                  <Button size="sm" variant="outline" className="gap-1.5 text-xs shrink-0" disabled={isbusy} onClick={printBoxOnly}>
                    <Printer className="w-3 h-3" /> Print
                  </Button>
                </div>

                {/* Wearer labels */}
                {labelData.wearers.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        Wearer Labels ({labelData.wearers.length})
                      </p>
                      {labelData.wearers.length > 1 && (
                        <Button size="sm" variant="outline" className="h-6 gap-1 text-xs" disabled={isbusy} onClick={printAll}>
                          <Printer className="w-3 h-3" /> Print All
                        </Button>
                      )}
                    </div>
                    {labelData.wearers.map((wearer) => (
                      <div key={wearer.name} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-border bg-card text-sm">
                        <div className="min-w-0">
                          <span className="font-medium truncate block">{wearer.name}</span>
                          {wearer.jobTitle && <span className="text-xs text-muted-foreground">{wearer.jobTitle}</span>}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge variant="secondary" className="text-xs">{wearer.items.reduce((s, i) => s + i.quantity, 0)} items</Badge>
                          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={isbusy} onClick={() => printWearer(wearer)}>
                            <Printer className="w-3 h-3" /> Print
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Print all in one go */}
                {labelData.wearers.length > 0 && (
                  <Button
                    className="w-full gap-1.5 bg-[#1e3a5f] hover:bg-[#162d4a] text-white"
                    disabled={isbusy}
                    onClick={printAll}
                  >
                    {isbusy
                      ? <><RefreshCw className="w-4 h-4 animate-spin" /> Printing {printedCount + 1} of {printQueue.length}…</>
                      : <><Printer className="w-4 h-4" /> Print All Labels ({1 + labelData.wearers.length} total)</>
                    }
                  </Button>
                )}
              </div>
            )}

            {status === "done" && (
              <div className="flex justify-end">
                <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setOpen(false)}>
                  <X className="w-3.5 h-3.5" /> Close
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
