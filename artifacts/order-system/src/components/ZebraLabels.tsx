import { useState, useEffect, useCallback } from "react";
import { Printer, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

// ── HTML label builder (4×4 in TSC) ─────────────────────────────────────────

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const SHIPPING_LABELS: Record<string, string> = {
  local_delivery: "Local Delivery",
  office_collection: "Office Collection",
  warehouse_collection: "Warehouse Collection",
  courier: "Courier",
  dpd: "DPD Courier",
  dpd_next_day: "DPD Next Day",
};

function shippingLabel(method: string | null | undefined): string {
  if (!method) return "";
  return SHIPPING_LABELS[method] ?? method;
}

function buildLabelHtml(data: LabelData, logoDataUrl: string, which: "all" | "box" | number): string {
  const css = `
    @page { size: 4in 4in; margin: 8mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { font-family: Arial, Helvetica, sans-serif; background: #fff; }
    .label {
      width: 100%;
      height: calc(4in - 16mm);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      page-break-after: always;
    }
    .label:last-child { page-break-after: auto; }
    .top-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 5pt;
      margin-bottom: 5pt;
      border-bottom: 2pt solid #000;
      flex-shrink: 0;
    }
    .top-bar-logo { height: 22pt; width: auto; display: block; }
    .top-bar-right { display: flex; flex-direction: column; align-items: flex-end; }
    .top-bar-type { font-size: 6pt; text-transform: uppercase; letter-spacing: .12em; color: #888; font-weight: 700; }
    .top-bar-order { font-size: 14pt; font-weight: 900; line-height: 1; }
    /* box label */
    .customer-name {
      font-size: 23pt;
      font-weight: 900;
      line-height: 1;
      padding-bottom: 5pt;
      margin-bottom: 6pt;
      border-bottom: 1.5pt solid #000;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex-shrink: 0;
    }
    .info-grid { display: flex; flex-direction: column; gap: 4pt; flex: 1; }
    .info-row { display: flex; align-items: baseline; }
    .info-key {
      width: 48pt;
      flex-shrink: 0;
      font-size: 6pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .07em;
      color: #777;
      padding-top: 1pt;
    }
    .info-val { font-size: 10pt; font-weight: 600; line-height: 1.2; }
    .address-block {
      margin-top: 5pt;
      padding-top: 5pt;
      border-top: 1pt solid #ddd;
      font-size: 9pt;
      line-height: 1.55;
      color: #222;
      flex-shrink: 0;
    }
    /* wearer label */
    .wearer-name {
      font-size: 26pt;
      font-weight: 900;
      line-height: 1.1;
      word-break: break-word;
      flex-shrink: 0;
    }
    .wearer-title { font-size: 9pt; color: #555; margin-top: 2pt; margin-bottom: 5pt; flex-shrink: 0; }
    .w-divider { border-top: 2pt solid #000; margin-bottom: 5pt; flex-shrink: 0; }
    table { width: 100%; border-collapse: collapse; }
    thead th {
      font-size: 6.5pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .08em;
      color: #666;
      border-bottom: 1.5pt solid #000;
      padding: 0 3pt 2.5pt;
      text-align: left;
    }
    thead th.r { text-align: right; }
    tbody td {
      font-size: 9pt;
      padding: 3pt 3pt;
      border-bottom: .75pt solid #e0e0e0;
      vertical-align: top;
      line-height: 1.25;
    }
    tbody td.r { text-align: right; font-weight: 800; }
    .finish { font-size: 7pt; color: #666; display: block; margin-top: 1pt; }
    .w-footer {
      margin-top: auto;
      padding-top: 3pt;
      border-top: 1pt solid #ccc;
      display: flex;
      justify-content: space-between;
      font-size: 7pt;
      color: #999;
      flex-shrink: 0;
    }
  `;

  const logoImg = logoDataUrl
    ? `<img class="top-bar-logo" src="${logoDataUrl}" alt="SBS">`
    : `<span style="font-size:8pt;font-weight:900">Select Branding Solutions</span>`;

  const nameLen = data.customerName.length;
  const namePt = nameLen > 22 ? 16 : nameLen > 16 ? 19 : 23;

  const boxLabelHtml = `
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
    ${data.shippingMethod ? `<div class="info-row"><span class="info-key">Delivery</span><span class="info-val">${esc(shippingLabel(data.shippingMethod))}</span></div>` : ""}
    ${data.isDpd && data.trackingNumber ? `<div class="info-row"><span class="info-key">DPD</span><span class="info-val">${esc(data.trackingNumber)}</span></div>` : ""}
    ${data.poNumber ? `<div class="info-row"><span class="info-key">PO Ref</span><span class="info-val">${esc(data.poNumber)}</span></div>` : ""}
    ${data.contactName ? `<div class="info-row"><span class="info-key">Contact</span><span class="info-val">${esc(data.contactName)}</span></div>` : ""}
    ${data.phone ? `<div class="info-row"><span class="info-key">Phone</span><span class="info-val">${esc(data.phone)}</span></div>` : ""}
  </div>
  ${data.addressLines.length ? `<div class="address-block">${data.addressLines.map(l => esc(l)).join("<br>")}</div>` : ""}
</div>`;

  const wearerLabelHtml = (w: LabelData["wearers"][0]) => {
    const wLen = w.name.length;
    const wPt = wLen > 28 ? 14 : wLen > 22 ? 17 : wLen > 16 ? 21 : 26;
    return `
<div class="label">
  <div class="top-bar">
    ${logoImg}
    <div class="top-bar-right">
      <span class="top-bar-type">Wearer Label</span>
      <span class="top-bar-order">${esc(data.orderNumber)}</span>
    </div>
  </div>
  <div class="wearer-name" style="font-size:${wPt}pt">${esc(w.name)}</div>
  ${w.jobTitle ? `<div class="wearer-title">${esc(w.jobTitle)}</div>` : `<div style="margin-bottom:5pt"></div>`}
  <div class="w-divider"></div>
  <table>
    <colgroup><col style="width:44%"><col style="width:26%"><col style="width:16%"><col style="width:14%"></colgroup>
    <thead><tr><th>Item</th><th>Colour</th><th>Size</th><th class="r">Qty</th></tr></thead>
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
  <div class="w-footer"><span>${esc(data.customerName)}</span><span>${esc(data.orderNumber)}</span></div>
</div>`;
  };

  let body = "";
  if (which === "box") {
    body = boxLabelHtml;
  } else if (which === "all") {
    body = boxLabelHtml + data.wearers.map(wearerLabelHtml).join("");
  } else {
    body = wearerLabelHtml(data.wearers[which]);
  }

  const qzScript = `(function(){var KEY='sbs_label_printer';function getPrinter(){try{return localStorage.getItem(KEY)||'TSC DA210';}catch(e){return 'TSC DA210';}}function setStatus(t){var el=document.getElementById('_qz_status');if(el)el.textContent=t;}function buildPrintHtml(){var c=document.documentElement.cloneNode(true);var rem=c.querySelectorAll('#_qz_toolbar,script');for(var i=0;i<rem.length;i++){if(rem[i].parentNode)rem[i].parentNode.removeChild(rem[i]);}return '<!DOCTYPE html><html>'+c.innerHTML+'</html>';}window.addEventListener('load',function(){var printer=getPrinter();setStatus('Connecting to QZ Tray\u2026');var s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/qz-tray@2.2.4/qz-tray.js';s.onload=function(){var qz=window.qz;qz.security.setCertificatePromise(function(){return Promise.resolve('');});qz.security.setSignatureAlgorithm('SHA512');qz.security.setSignaturePromise(function(){return Promise.resolve('');});var conn=qz.websocket.isActive()?Promise.resolve():qz.websocket.connect({retries:1,delay:0.5});conn.then(function(){setStatus('Sending to '+printer+'\u2026');return qz.print(qz.configs.create(printer),[{type:'pixel',format:'html',flavor:'plain',data:buildPrintHtml()}]);}).then(function(){setStatus('\u2714 Sent to '+printer);}).catch(function(){setStatus('QZ Tray error \u2014 using browser dialog');window.print();});};s.onerror=function(){setStatus('QZ Tray not running \u2014 using browser dialog');window.print();};document.head.appendChild(s);});})();`;

  const promptBar = `
<div id="_qz_toolbar" class="no-print" style="position:fixed;top:0;left:0;right:0;z-index:999;background:#1e3a5f;color:#fff;font-family:Arial,sans-serif;font-size:13px;padding:10px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;">
  <span id="_qz_status" style="opacity:.85">Starting\u2026</span>
  <button onclick="window.print()" style="background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.3);border-radius:4px;padding:5px 14px;font-size:12px;font-weight:600;cursor:pointer;">Print manually</button>
</div>
<div class="no-print" style="height:44px"></div>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>Labels \u2014 ${esc(data.orderNumber)}</title>
<style>${css} @media print { .no-print { display: none !important; } }</style>
</head><body>${promptBar}${body}<script>${qzScript}</script></body></html>`;
}

async function doPrint(data: LabelData, base: string, which: "all" | "box" | number) {
  // Open window synchronously (must be direct from click — no awaits before this)
  const win = window.open("", "_blank", "width=700,height=520");
  if (!win) { alert("Pop-up blocked — please allow pop-ups for this site and try again."); return; }
  win.document.write("<html><body style='font-family:Arial;padding:24px;color:#555'>Preparing labels…</body></html>");

  let logoDataUrl = "";
  try {
    const res = await fetch(`${base}sbs-logo.png`);
    const blob = await res.blob();
    logoDataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  } catch { /* proceed without logo */ }

  const html = buildLabelHtml(data, logoDataUrl, which);
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
}

// ── Component ─────────────────────────────────────────────────────────────────

interface ZebraLabelsProps { orderId: number; orderNumber: string; hasNamedRecipients: boolean; }

export default function ZebraLabels({ orderId, orderNumber }: ZebraLabelsProps) {
  const [open, setOpen] = useState(false);
  const [labelData, setLabelData] = useState<LabelData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const base = import.meta.env.BASE_URL;

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/orders/${orderId}/label-data`);
      if (!res.ok) throw new Error(await res.text());
      setLabelData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load label data");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    if (open) loadData();
    else { setLabelData(null); setError(""); }
  }, [open, loadData]);

  const ready = !loading && !!labelData;

  return (
    <>
      <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => setOpen(true)}>
        <Printer className="w-3.5 h-3.5" /> Labels
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Printer className="w-5 h-5" /> Print Labels — {orderNumber}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-1 overflow-y-auto flex-1 min-h-0 pr-1">
            {loading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <RefreshCw className="w-4 h-4 animate-spin" /> Loading label data…
              </div>
            )}

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">
                {error}
                <button className="ml-2 underline text-xs" onClick={loadData}>Retry</button>
              </div>
            )}

            {ready && labelData && (
              <>
                {/* Box label */}
                <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-border bg-card">
                  <div>
                    <p className="text-sm font-medium">Box Label</p>
                    <p className="text-xs text-muted-foreground">{labelData.customerName} · {shippingLabel(labelData.shippingMethod)}</p>
                  </div>
                  <Button size="sm" variant="outline" className="gap-1.5 text-xs shrink-0"
                    onClick={() => doPrint(labelData, base, "box")}>
                    <Printer className="w-3 h-3" /> Print
                  </Button>
                </div>

                {/* Wearer labels */}
                {labelData.wearers.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between px-0.5">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        Wearer Labels ({labelData.wearers.length})
                      </p>
                      {labelData.wearers.length > 1 && (
                        <Button size="sm" variant="outline" className="h-6 gap-1 text-xs"
                          onClick={() => doPrint(labelData, base, "all")}>
                          <Printer className="w-3 h-3" /> Print All
                        </Button>
                      )}
                    </div>
                    {labelData.wearers.map((w, i) => (
                      <div key={w.name} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-border bg-card text-sm">
                        <div className="min-w-0">
                          <span className="font-medium truncate block">{w.name}</span>
                          {w.jobTitle && <span className="text-xs text-muted-foreground">{w.jobTitle}</span>}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge variant="secondary" className="text-xs">{w.items.reduce((s, it) => s + it.quantity, 0)} items</Badge>
                          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs"
                            onClick={() => doPrint(labelData, base, i)}>
                            <Printer className="w-3 h-3" /> Print
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Print all */}
                <Button
                  className="w-full gap-1.5 bg-[#1e3a5f] hover:bg-[#162d4a] text-white"
                  onClick={() => doPrint(labelData, base, "all")}
                >
                  <Printer className="w-4 h-4" /> Print All Labels ({1 + labelData.wearers.length} total)
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
