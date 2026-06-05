import { useState, useEffect, useCallback } from "react";
import { Printer, CheckCircle, AlertTriangle, RefreshCw, X, Monitor } from "lucide-react";
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

function zplEscape(s: string): string {
  return s.replace(/[\\^~]/g, " ").replace(/[^\x20-\x7E]/g, "?");
}

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
  const W = 812; const H = 609;
  const lines: string[] = [];
  lines.push("^XA");
  lines.push(`^PW${W}^LL${H}^LH0,0`);
  lines.push("^FO20,10^A0N,22,22^FDBOX LABEL^FS");
  lines.push(`^FO${W - 20},10^A0N,22,22^FB200,1,0,R^FD${zplEscape(data.orderNumber)}^FS`);
  lines.push(`^FO0,40^GB${W},2,2^FS`);
  lines.push(`^FO20,50^A0N,44,44^FD${zplEscape(data.customerName.slice(0, 28))}^FS`);
  lines.push(`^FO0,104^GB${W},2,2^FS`);
  let y = 114; const KEY_W = 160;
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

function buildWearerLabelZpl(data: LabelData, wearer: LabelData["wearers"][0]): string {
  const W = 812; const H = 609;
  const lines: string[] = [];
  lines.push("^XA");
  lines.push(`^PW${W}^LL${H}^LH0,0`);
  lines.push(`^FO20,12^A0N,48,48^FD${zplEscape(wearer.name.slice(0, 30))}^FS`);
  if (wearer.jobTitle) lines.push(`^FO20,68^A0N,22,22^FD${zplEscape(wearer.jobTitle.slice(0, 45))}^FS`);
  lines.push(`^FO0,${wearer.jobTitle ? 96 : 68}^GB${W},2,2^FS`);
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
    if (item.finishName) lines.push(`^FO20,${y + 22}^A0N,16,16^FD${zplEscape(item.finishName.slice(0, 32))}^FS`);
    if (item.colour) lines.push(`^FO370,${y}^A0N,20,20^FD${zplEscape(item.colour.slice(0, 12))}^FS`);
    if (item.size)   lines.push(`^FO520,${y}^A0N,20,20^FD${zplEscape(item.size.slice(0, 8))}^FS`);
    lines.push(`^FO650,${y}^A0N,22,22^FD${item.quantity}^FS`);
    const rowH = item.finishName ? 44 : 28;
    y += rowH;
    lines.push(`^FO0,${y}^GB${W},1,1^FS`);
    y += 2;
    if (y > H - 40) break;
  }
  lines.push(`^FO20,${H - 30}^A0N,20,20^FD${zplEscape(data.customerName)}^FS`);
  lines.push(`^FO${W - 20},${H - 30}^A0N,20,20^FB150,1,0,R^FD${zplEscape(data.orderNumber)}^FS`);
  lines.push("^XZ");
  return lines.join("\n");
}

// ── HTML browser print ────────────────────────────────────────────────────────

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildBrowserPrintHtml(data: LabelData, logoDataUrl: string, size: LabelSize): string {
  const is4x4 = size === "4x4";
  const pageW = is4x4 ? "4in" : "6in";
  const pageH = "4in";
  // Slightly smaller fonts for 4×4 (less width)
  const scale = is4x4 ? 0.78 : 1;
  const pt = (n: number) => `${Math.round(n * scale)}pt`;

  const css = `
    @page { size: ${pageW} ${pageH}; margin: 8mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { font-family: Arial, Helvetica, sans-serif; background: #fff; }
    .label {
      width: 100%;
      height: calc(${pageH} - 16mm);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      page-break-after: always;
    }
    .label:last-child { page-break-after: auto; }

    /* ── top bar (logo left, type+order right) ── */
    .top-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 6pt;
      margin-bottom: 6pt;
      border-bottom: 2.5pt solid #000;
      flex-shrink: 0;
    }
    .top-bar-logo { height: ${pt(28)}; width: auto; display: block; }
    .top-bar-right { display: flex; flex-direction: column; align-items: flex-end; }
    .top-bar-type { font-size: ${pt(7)}; text-transform: uppercase; letter-spacing: .12em; color: #888; font-weight: 700; }
    .top-bar-order { font-size: ${pt(18)}; font-weight: 900; letter-spacing: .01em; line-height: 1; }

    /* ── box label ── */
    .customer-name {
      font-size: ${pt(30)};
      font-weight: 900;
      line-height: 1;
      padding-bottom: 6pt;
      margin-bottom: 8pt;
      border-bottom: 1.5pt solid #000;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex-shrink: 0;
    }
    .info-grid { display: flex; flex-direction: column; gap: 5pt; flex: 1; }
    .info-row { display: flex; align-items: baseline; }
    .info-key {
      width: ${pt(62)};
      flex-shrink: 0;
      font-size: ${pt(7.5)};
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .07em;
      color: #777;
      padding-top: 1.5pt;
    }
    .info-val { font-size: ${pt(13)}; font-weight: 600; line-height: 1.2; }
    .address-block {
      margin-top: 6pt;
      padding-top: 6pt;
      border-top: 1pt solid #ddd;
      font-size: ${pt(11)};
      line-height: 1.6;
      color: #222;
      flex-shrink: 0;
    }

    /* ── wearer label ── */
    .wearer-name {
      font-size: ${pt(34)};
      font-weight: 900;
      line-height: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex-shrink: 0;
    }
    .wearer-title {
      font-size: ${pt(11)};
      color: #555;
      margin-top: 2pt;
      margin-bottom: 6pt;
      flex-shrink: 0;
    }
    .w-divider { border-top: 2.5pt solid #000; margin-bottom: 6pt; flex-shrink: 0; }
    table { width: 100%; border-collapse: collapse; }
    thead th {
      font-size: ${pt(8)};
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .08em;
      color: #666;
      border-bottom: 1.5pt solid #000;
      padding: 0 4pt 3pt;
      text-align: left;
    }
    thead th.r { text-align: right; }
    tbody td {
      font-size: ${pt(11)};
      padding: 4pt 4pt;
      border-bottom: .75pt solid #e0e0e0;
      vertical-align: top;
      line-height: 1.3;
    }
    tbody td.r { text-align: right; font-weight: 800; }
    .finish { font-size: ${pt(8.5)}; color: #666; display: block; margin-top: 1pt; }
    .w-footer {
      margin-top: auto;
      padding-top: 4pt;
      border-top: 1pt solid #ccc;
      display: flex;
      justify-content: space-between;
      font-size: ${pt(8.5)};
      color: #999;
      flex-shrink: 0;
    }
  `;

  // Scale customer name down for long names (then apply size scale)
  const nameLen = data.customerName.length;
  const namePt = Math.round((nameLen > 24 ? 20 : nameLen > 18 ? 25 : 30) * scale);

  const logoImg = logoDataUrl
    ? `<img class="top-bar-logo" src="${logoDataUrl}" alt="SBS">`
    : `<span style="font-size:11pt;font-weight:900;letter-spacing:.01em">Select Branding Solutions</span>`;

  const boxLabel = `
<div class="label">
  <div class="top-bar">
    ${logoImg}
    <div class="top-bar-right">
      <span class="top-bar-type">Box Label</span>
      <span class="top-bar-order">${esc(data.orderNumber)}</span>
    </div>
  </div>
  <div class="customer-name" style="font-size:${namePt}pt">${esc(data.customerName)}</div>
  <div class="info-grid">
    ${data.shippingMethod ? `<div class="info-row"><span class="info-key">Delivery</span><span class="info-val">${esc(data.shippingMethod)}</span></div>` : ""}
    ${data.isDpd && data.trackingNumber ? `<div class="info-row"><span class="info-key">DPD</span><span class="info-val">${esc(data.trackingNumber)}</span></div>` : ""}
    ${data.poNumber ? `<div class="info-row"><span class="info-key">PO Ref</span><span class="info-val">${esc(data.poNumber)}</span></div>` : ""}
    ${data.contactName ? `<div class="info-row"><span class="info-key">Contact</span><span class="info-val">${esc(data.contactName)}</span></div>` : ""}
    ${data.phone ? `<div class="info-row"><span class="info-key">Phone</span><span class="info-val">${esc(data.phone)}</span></div>` : ""}
  </div>
  ${data.addressLines.length ? `<div class="address-block">${data.addressLines.map(l => esc(l)).join("<br>")}</div>` : ""}
</div>`;

  const wearerLabels = data.wearers.map(w => {
    const wNameLen = w.name.length;
    const wNamePt = Math.round((wNameLen > 24 ? 22 : wNameLen > 18 ? 28 : 34) * scale);
    return `
<div class="label">
  <div class="top-bar">
    ${logoImg}
    <div class="top-bar-right">
      <span class="top-bar-type">Wearer Label</span>
      <span class="top-bar-order">${esc(data.orderNumber)}</span>
    </div>
  </div>
  <div class="wearer-name" style="font-size:${wNamePt}pt">${esc(w.name)}</div>
  ${w.jobTitle ? `<div class="wearer-title">${esc(w.jobTitle)}</div>` : `<div style="margin-bottom:6pt"></div>`}
  <div class="w-divider"></div>
  <table>
    <colgroup>
      <col style="width:45%"><col style="width:25%"><col style="width:16%"><col style="width:14%">
    </colgroup>
    <thead>
      <tr><th>Item</th><th>Colour</th><th>Size</th><th class="r">Qty</th></tr>
    </thead>
    <tbody>
      ${w.items.map(item => `
      <tr>
        <td>${esc(item.productName)}${item.finishName ? `<span class="finish">${esc(item.finishName)}</span>` : ""}</td>
        <td>${item.colour ? esc(item.colour) : "—"}</td>
        <td>${item.size ? esc(item.size) : "—"}</td>
        <td class="r">${item.quantity}</td>
      </tr>`).join("")}
    </tbody>
  </table>
  <div class="w-footer">
    <span>${esc(data.customerName)}</span>
    <span>${esc(data.orderNumber)}</span>
  </div>
</div>`;
  }).join("");

  const sizeLabel = is4x4 ? "4×4 in (102×102 mm) — TSC" : "6×4 in (152×102 mm) — Zebra";
  const promptBar = `
<div class="no-print" style="position:fixed;top:0;left:0;right:0;z-index:999;background:#1e3a5f;color:#fff;font-family:Arial,sans-serif;font-size:13px;padding:10px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;">
  <span>Select your label printer in the print dialog — paper size: <strong>${sizeLabel}</strong>.</span>
  <button onclick="window.print()" style="background:#fff;color:#1e3a5f;border:none;border-radius:4px;padding:6px 16px;font-size:13px;font-weight:700;cursor:pointer;">Print Labels</button>
</div>
<div class="no-print" style="height:44px"></div>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>Labels \u2014 ${esc(data.orderNumber)}</title>
<style>${css} @media print { .no-print { display: none !important; } }</style>
</head><body>${promptBar}${boxLabel}${wearerLabels}</body></html>`;
}

async function openBrowserPrint(data: LabelData, base: string, size: LabelSize) {
  // Open the window synchronously (must happen directly from the click event)
  // so the browser doesn't treat it as a blocked pop-up
  const win = window.open("", "_blank", "width=700,height=520");
  if (!win) { alert("Pop-up blocked — please allow pop-ups for this site and try again."); return; }
  win.document.write("<html><body style='font-family:Arial;padding:24px;color:#555'>Preparing labels…</body></html>");

  // Now do the async logo fetch
  let logoDataUrl = "";
  try {
    const res = await fetch(`${base}sbs-logo.png`);
    const blob = await res.blob();
    logoDataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  } catch { /* logo unavailable — print without it */ }

  const html = buildBrowserPrintHtml(data, logoDataUrl, size);
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
}

// ── Zebra Browser Print REST API ─────────────────────────────────────────────

const ZBP_ORIGIN = "https://127.0.0.1:9101";

interface ZbrDevice { name: string; uid: string; connection: string; deviceType: string; }

async function zbpFetch(path: string, options?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    return await fetch(`${ZBP_ORIGIN}${path}`, { ...options, signal: controller.signal });
  } finally { clearTimeout(timer); }
}

async function getAvailablePrinters(): Promise<ZbrDevice[]> {
  const res = await zbpFetch("/available");
  if (!res.ok) throw new Error(`Zebra Browser Print returned ${res.status}`);
  const data = await res.json();
  return (data.printer ?? []) as ZbrDevice[];
}

async function getDefaultPrinter(): Promise<ZbrDevice | null> {
  try {
    const res = await zbpFetch("/default?type=printer");
    if (!res.ok) return null;
    const data = await res.json();
    return data?.uid ? (data as ZbrDevice) : null;
  } catch { return null; }
}

async function sendZpl(device: ZbrDevice, zpl: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(`${ZBP_ORIGIN}/write`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device, data: zpl }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Printer error ${res.status}${text ? `: ${text}` : ""}`);
    }
  } finally { clearTimeout(timer); }
}

function isCertError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return err instanceof TypeError || msg.toLowerCase().includes("failed to fetch") || msg.toLowerCase().includes("networkerror") || msg.toLowerCase().includes("aborted");
}

// ── Main component ────────────────────────────────────────────────────────────

interface ZebraLabelsProps { orderId: number; orderNumber: string; hasNamedRecipients: boolean; }
type ZebraStatus = "idle" | "loading" | "ready" | "printing" | "done" | "error";

const SAVED_PRINTER_KEY = "sbs_zebra_printer_uid";
const SAVED_LABEL_SIZE_KEY = "sbs_label_size";

type LabelSize = "6x4" | "4x4";
const LABEL_SIZES: { value: LabelSize; label: string; sub: string }[] = [
  { value: "6x4", label: "6 × 4 in", sub: "Zebra / standard" },
  { value: "4x4", label: "4 × 4 in", sub: "TSC" },
];

function getSavedLabelSize(): LabelSize {
  try { const v = localStorage.getItem(SAVED_LABEL_SIZE_KEY); return (v === "4x4" ? "4x4" : "6x4"); } catch { return "6x4"; }
}

export default function ZebraLabels({ orderId, orderNumber, hasNamedRecipients: _h }: ZebraLabelsProps) {
  const [open, setOpen] = useState(false);
  const [zebraStatus, setZebraStatus] = useState<ZebraStatus>("idle");
  const [zebraMsg, setZebraMsg] = useState("");
  const [isCert, setIsCert] = useState(false);
  const [printer, setPrinter] = useState<ZbrDevice | null>(null);
  const [allPrinters, setAllPrinters] = useState<ZbrDevice[]>([]);
  const [labelData, setLabelData] = useState<LabelData | null>(null);
  const [labelLoading, setLabelLoading] = useState(false);
  const [printQueue, setPrintQueue] = useState<string[]>([]);
  const [printedCount, setPrintedCount] = useState(0);
  const [labelSize, setLabelSize] = useState<LabelSize>(getSavedLabelSize);

  function saveLabelSize(s: LabelSize) {
    setLabelSize(s);
    try { localStorage.setItem(SAVED_LABEL_SIZE_KEY, s); } catch {}
  }

  function savePrinter(device: ZbrDevice) {
    setPrinter(device);
    try { localStorage.setItem(SAVED_PRINTER_KEY, device.uid); } catch {}
  }

  // Load label data independently from Zebra connection
  const loadLabelData = useCallback(async () => {
    setLabelLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/orders/${orderId}/label-data`);
      if (!resp.ok) throw new Error(await resp.text());
      setLabelData(await resp.json());
    } catch { /* label data unavailable */ }
    finally { setLabelLoading(false); }
  }, [orderId]);

  // Try to connect to Zebra Browser Print
  const connectZebra = useCallback(async () => {
    setZebraStatus("loading");
    setIsCert(false);
    setZebraMsg("Connecting to Zebra Browser Print…");
    try {
      const [printers, defaultDevice] = await Promise.all([
        getAvailablePrinters(),
        getDefaultPrinter(),
      ]);
      const available = printers.length > 0 ? printers : (defaultDevice ? [defaultDevice] : []);
      if (available.length === 0) throw new Error("No Zebra printers found. Make sure the printer is switched on and connected.");
      setAllPrinters(available);
      const savedUid = (() => { try { return localStorage.getItem(SAVED_PRINTER_KEY); } catch { return null; } })();
      const restored = savedUid ? available.find(d => d.uid === savedUid) : null;
      const chosen = restored ?? defaultDevice ?? available[0];
      setPrinter(chosen ?? null);
      setZebraStatus("ready");
      setZebraMsg(`Connected to ${chosen?.name ?? "printer"}`);
    } catch (err: unknown) {
      setZebraStatus("error");
      if (isCertError(err)) { setIsCert(true); setZebraMsg("Cannot reach Zebra Browser Print"); }
      else { setIsCert(false); setZebraMsg(err instanceof Error ? err.message : String(err)); }
    }
  }, []);

  useEffect(() => {
    if (open) { loadLabelData(); connectZebra(); }
    else { setZebraStatus("idle"); setIsCert(false); setPrinter(null); setLabelData(null); setPrintQueue([]); setPrintedCount(0); }
  }, [open, loadLabelData, connectZebra]);

  async function printAll() {
    if (!printer || !labelData) return;
    setZebraStatus("printing");
    const jobs: string[] = [buildBoxLabelZpl(labelData), ...labelData.wearers.map(w => buildWearerLabelZpl(labelData, w))];
    setPrintQueue(jobs.map((_, i) => i === 0 ? "Box label" : `Wearer: ${labelData.wearers[i - 1].name}`));
    let printed = 0;
    for (const zpl of jobs) {
      try { await sendZpl(printer, zpl); printed++; setPrintedCount(printed); }
      catch (err) { setZebraStatus("error"); setZebraMsg(`Print failed on job ${printed + 1}: ${err}`); return; }
    }
    setZebraStatus("done");
    setZebraMsg(`Printed ${printed} label${printed !== 1 ? "s" : ""}`);
  }

  async function printBoxOnly() {
    if (!printer || !labelData) return;
    setZebraStatus("printing");
    try { await sendZpl(printer, buildBoxLabelZpl(labelData)); setZebraStatus("done"); setZebraMsg("Box label printed"); }
    catch (err) { setZebraStatus("error"); setZebraMsg(`Print failed: ${err}`); }
  }

  async function printWearer(wearer: LabelData["wearers"][0]) {
    if (!printer || !labelData) return;
    setZebraStatus("printing");
    try { await sendZpl(printer, buildWearerLabelZpl(labelData, wearer)); setZebraStatus("done"); setZebraMsg(`Printed: ${wearer.name}`); }
    catch (err) { setZebraStatus("error"); setZebraMsg(`Print failed: ${err}`); }
  }

  const zebraReady = zebraStatus === "ready" || zebraStatus === "done";
  const isbusy = zebraStatus === "loading" || zebraStatus === "printing";

  return (
    <>
      <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => setOpen(true)}>
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

            {/* ── Browser print — always available ── */}
            <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 space-y-2.5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium flex items-center gap-1.5">
                  <Monitor className="w-3.5 h-3.5 text-muted-foreground" /> Print via browser
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 gap-1.5 text-xs"
                  disabled={!labelData || labelLoading}
                  onClick={() => labelData && openBrowserPrint(labelData, import.meta.env.BASE_URL, labelSize)}
                >
                  {labelLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Printer className="w-3 h-3" />}
                  {labelLoading ? "Loading…" : "Print"}
                </Button>
              </div>
              {/* Label size selector */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground shrink-0">Label size:</span>
                <div className="flex rounded-md border border-input overflow-hidden text-xs">
                  {LABEL_SIZES.map(s => (
                    <button
                      key={s.value}
                      onClick={() => saveLabelSize(s.value)}
                      className={`px-2.5 py-1 font-medium transition-colors ${labelSize === s.value ? "bg-[#1e3a5f] text-white" : "bg-background text-muted-foreground hover:text-foreground"}`}
                    >
                      {s.label} <span className="opacity-60 font-normal">{s.sub}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Zebra / ZPL section ── */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Zebra direct (ZPL)</p>

              {/* Zebra status */}
              <div className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm ${
                zebraStatus === "error" ? "border-red-200 bg-red-50 text-red-700" :
                zebraReady ? "border-green-200 bg-green-50 text-green-700" :
                "border-border bg-muted/30 text-muted-foreground"
              }`}>
                {zebraStatus === "loading" && <RefreshCw className="w-4 h-4 animate-spin flex-shrink-0" />}
                {zebraReady && <CheckCircle className="w-4 h-4 flex-shrink-0" />}
                {zebraStatus === "error" && <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
                {zebraStatus === "printing" && <RefreshCw className="w-4 h-4 animate-spin flex-shrink-0" />}
                {zebraStatus === "idle" && <Printer className="w-4 h-4 flex-shrink-0" />}
                <span className="flex-1 min-w-0 text-xs">{zebraMsg || "Connecting…"}</span>
                {zebraStatus === "error" && (
                  <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={connectZebra}>Retry</Button>
                )}
              </div>

              {/* Cert help */}
              {zebraStatus === "error" && isCert && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-900 space-y-2">
                  <p className="font-semibold">One-time browser trust required</p>
                  <ol className="list-decimal list-inside space-y-1">
                    <li>Open <a href={ZBP_ORIGIN} target="_blank" rel="noopener noreferrer" className="underline font-medium">https://127.0.0.1:9101</a> in a new tab</li>
                    <li>Click <strong>Advanced</strong> → <strong>Proceed to 127.0.0.1</strong></li>
                    <li>Come back here and click <strong>Retry</strong></li>
                  </ol>
                </div>
              )}

              {/* Printer selector */}
              {allPrinters.length > 1 && printer && (
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground font-medium">Printer</label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                    value={printer.uid}
                    onChange={(e) => { const p = allPrinters.find(d => d.uid === e.target.value); if (p) savePrinter(p); }}
                  >
                    {allPrinters.map(p => <option key={p.uid} value={p.uid}>{p.name}</option>)}
                  </select>
                </div>
              )}

              {/* ZPL print actions */}
              {zebraReady && labelData && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-border bg-card">
                    <div>
                      <p className="text-sm font-medium">Box Label</p>
                      <p className="text-xs text-muted-foreground">{labelData.customerName} · {labelData.shippingMethod}</p>
                    </div>
                    <Button size="sm" variant="outline" className="gap-1.5 text-xs shrink-0" disabled={isbusy} onClick={printBoxOnly}>
                      <Printer className="w-3 h-3" /> Print
                    </Button>
                  </div>

                  {labelData.wearers.length > 0 && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Wearer Labels ({labelData.wearers.length})</p>
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

                  {labelData.wearers.length > 0 && (
                    <Button className="w-full gap-1.5 bg-[#1e3a5f] hover:bg-[#162d4a] text-white" disabled={isbusy} onClick={printAll}>
                      {isbusy
                        ? <><RefreshCw className="w-4 h-4 animate-spin" /> Printing {printedCount + 1} of {printQueue.length}…</>
                        : <><Printer className="w-4 h-4" /> Print All Labels ({1 + labelData.wearers.length} total)</>
                      }
                    </Button>
                  )}
                </div>
              )}
            </div>

            {zebraReady && (
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
