import nodemailer from "nodemailer";
import PDFDocument from "pdfkit";
import { db, settingsTable, ordersTable, orderItemsTable, customersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export const isEmailConfigured = !!(
  process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
);

const transporter = isEmailConfigured
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT ?? "587"),
      secure: process.env.SMTP_SECURE === "true",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
}): Promise<{ sent: boolean; error?: string }> {
  if (!transporter) return { sent: false, error: "SMTP not configured" };
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM ?? `"Select Branding Solutions" <${process.env.SMTP_USER}>`,
      ...opts,
    });
    return { sent: true };
  } catch (err: any) {
    return { sent: false, error: err.message };
  }
}

export function buildAcknowledgementEmail(order: {
  orderNumber: string;
  customerName: string | null;
  orderDate: Date | null;
  requiredDate?: Date | null;
  notes?: string | null;
  totalAmount?: number | null;
  items: Array<{
    productName: string;
    colour?: string | null;
    size?: string | null;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    recipientName?: string | null;
  }>;
}): { subject: string; html: string; text: string } {
  const subject = `Order Confirmation – ${order.orderNumber}`;
  const dateStr = order.orderDate
    ? new Date(order.orderDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
    : new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const requiredStr = order.requiredDate
    ? new Date(order.requiredDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
    : null;

  const itemRows = order.items
    .map(
      (i) =>
        `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${i.productName}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;">${[i.colour, i.size].filter(Boolean).join(" / ") || "—"}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${i.recipientName || "Stock"}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${i.quantity}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">£${i.unitPrice.toFixed(2)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600;">£${i.lineTotal.toFixed(2)}</td>
        </tr>`
    )
    .join("\n");

  const total = order.totalAmount ?? order.items.reduce((s, i) => s + i.lineTotal, 0);

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
        <tr><td style="background:#1e293b;padding:24px 32px;">
          <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700;">Select Branding Solutions</h1>
          <p style="margin:4px 0 0;color:#94a3b8;font-size:13px;">Order Confirmation</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 24px;font-size:15px;color:#374151;">
            Dear ${order.customerName ?? "Valued Customer"},<br><br>
            Thank you for your order. We are pleased to confirm the following:
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr>
              <td style="padding:8px 0;color:#6b7280;font-size:14px;">Order number</td>
              <td style="padding:8px 0;font-size:14px;font-weight:700;color:#1e293b;">${order.orderNumber}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6b7280;font-size:14px;">Order date</td>
              <td style="padding:8px 0;font-size:14px;color:#374151;">${dateStr}</td>
            </tr>
            ${
              requiredStr
                ? `<tr>
              <td style="padding:8px 0;color:#6b7280;font-size:14px;">Required by</td>
              <td style="padding:8px 0;font-size:14px;color:#374151;">${requiredStr}</td>
            </tr>`
                : ""
            }
          </table>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;margin-bottom:24px;border-collapse:collapse;">
            <thead>
              <tr style="background:#f8fafc;">
                <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;border-bottom:1px solid #e5e7eb;">Product</th>
                <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;border-bottom:1px solid #e5e7eb;">Variant</th>
                <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;border-bottom:1px solid #e5e7eb;">For</th>
                <th style="padding:10px 12px;text-align:center;font-size:12px;color:#6b7280;font-weight:600;border-bottom:1px solid #e5e7eb;">Qty</th>
                <th style="padding:10px 12px;text-align:right;font-size:12px;color:#6b7280;font-weight:600;border-bottom:1px solid #e5e7eb;">Unit</th>
                <th style="padding:10px 12px;text-align:right;font-size:12px;color:#6b7280;font-weight:600;border-bottom:1px solid #e5e7eb;">Total</th>
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
            <tfoot>
              <tr style="background:#f8fafc;">
                <td colspan="5" style="padding:12px;text-align:right;font-weight:600;font-size:15px;color:#1e293b;">Order Total</td>
                <td style="padding:12px;text-align:right;font-weight:700;font-size:15px;color:#1e293b;">£${total.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
          ${order.notes ? `<p style="font-size:14px;color:#374151;margin-bottom:24px;"><strong>Notes:</strong> ${order.notes}</p>` : ""}
          <p style="font-size:14px;color:#374151;margin:0;">
            If you have any questions regarding your order, please don't hesitate to get in touch.<br><br>
            Kind regards,<br>
            <strong>Select Branding Solutions</strong>
          </p>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e5e7eb;">
          <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">Select Branding Solutions · Effortless uniform management from order to delivery.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    `ORDER CONFIRMATION – ${order.orderNumber}`,
    ``,
    `Dear ${order.customerName ?? "Valued Customer"},`,
    ``,
    `Thank you for your order. We are pleased to confirm the following details:`,
    ``,
    `Order Number: ${order.orderNumber}`,
    `Order Date: ${dateStr}`,
    requiredStr ? `Required By: ${requiredStr}` : null,
    ``,
    `ITEMS:`,
    ...order.items.map(
      (i) =>
        `  ${i.productName}${[i.colour, i.size].filter(Boolean).length ? ` (${[i.colour, i.size].filter(Boolean).join(", ")})` : ""} – Qty: ${i.quantity} @ £${i.unitPrice.toFixed(2)} = £${i.lineTotal.toFixed(2)}`
    ),
    ``,
    `ORDER TOTAL: £${total.toFixed(2)}`,
    ``,
    order.notes ? `Notes: ${order.notes}\n` : null,
    `If you have any questions, please don't hesitate to get in touch.`,
    ``,
    `Kind regards,`,
    `Select Branding Solutions`,
  ]
    .filter((l) => l !== null)
    .join("\n");

  return { subject, html, text };
}

// ─── Purchase Order PDF + Email ───────────────────────────────────────────────

interface POItemData {
  supplierCode: string | null;
  productName: string;
  colour: string | null;
  size: string | null;
  supplierPrice: number | null;
  quantityOrdered: number;
}

interface POData {
  poNumber: string;
  supplierName: string;
  supplierEmail: string | null;
  createdAt: Date | string;
  notes: string | null;
  items: POItemData[];
}

/** Build a matrix: groups by (supplierCode|productName), rows = colours, cols = sizes */
function buildMatrix(items: POItemData[]) {
  const groupKeys: string[] = [];
  const groups = new Map<string, { code: string | null; productName: string; price: number | null; colours: string[]; sizes: string[]; qty: Map<string, Map<string, number>> }>();

  for (const item of items) {
    const gk = item.supplierCode ?? item.productName;
    if (!groups.has(gk)) {
      groupKeys.push(gk);
      groups.set(gk, { code: item.supplierCode, productName: item.productName, price: item.supplierPrice, colours: [], sizes: [], qty: new Map() });
    }
    const g = groups.get(gk)!;
    const c = item.colour ?? "—";
    const s = item.size ?? "—";
    if (!g.colours.includes(c)) g.colours.push(c);
    if (!g.sizes.includes(s)) g.sizes.push(s);
    if (!g.qty.has(c)) g.qty.set(c, new Map());
    g.qty.get(c)!.set(s, item.quantityOrdered);
    if (item.supplierPrice != null && g.price == null) g.price = item.supplierPrice;
  }
  return { groupKeys, groups };
}

export async function generatePOPdf(po: POData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const W = doc.page.width - 100;
    const dateStr = new Date(po.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

    // Header
    doc.rect(50, 50, W, 70).fill("#1e293b");
    doc.fillColor("#ffffff").fontSize(18).font("Helvetica-Bold").text("Select Branding Solutions", 65, 62);
    doc.fillColor("#94a3b8").fontSize(10).font("Helvetica").text("Purchase Order", 65, 84);
    doc.fillColor("#ffffff").fontSize(10).text(`${po.poNumber}  ·  ${dateStr}`, 65, 100);

    doc.fillColor("#000000").fontSize(10).font("Helvetica").moveDown(2);

    // Supplier block
    doc.font("Helvetica-Bold").text("Supplier:", 50, 140).font("Helvetica").text(po.supplierName, 120, 140);
    if (po.supplierEmail) doc.font("Helvetica-Bold").text("Email:", 50, 155).font("Helvetica").text(po.supplierEmail, 120, 155);
    if (po.notes) doc.font("Helvetica-Bold").text("Notes:", 50, 170).font("Helvetica").text(po.notes, 120, 170);

    const tableTop = po.notes ? 200 : po.supplierEmail ? 185 : 170;

    // Build matrix
    const { groupKeys, groups } = buildMatrix(po.items);

    // Collect all unique sizes across all groups
    const allSizes: string[] = [];
    for (const gk of groupKeys) {
      for (const s of groups.get(gk)!.sizes) {
        if (!allSizes.includes(s)) allSizes.push(s);
      }
    }

    // Column widths: Code | Colour | [sizes] | Total
    const codeW = 80;
    const colourW = 100;
    const totalW = 45;
    const sizeW = Math.min(55, Math.max(40, Math.floor((W - codeW - colourW - totalW) / Math.max(allSizes.length, 1))));
    const tableW = codeW + colourW + sizeW * allSizes.length + totalW;
    const startX = 50 + (W - tableW) / 2;

    // Draw header row
    let y = tableTop;
    const rowH = 18;
    doc.rect(startX, y, tableW, rowH).fill("#1e293b");
    doc.fillColor("#ffffff").fontSize(8).font("Helvetica-Bold");

    doc.text("Code", startX + 4, y + 5, { width: codeW - 4 });
    doc.text("Colour", startX + codeW + 4, y + 5, { width: colourW - 4 });
    let sx = startX + codeW + colourW;
    for (const s of allSizes) {
      doc.text(s, sx + 2, y + 5, { width: sizeW - 4, align: "center" });
      sx += sizeW;
    }
    doc.text("Total", sx + 2, y + 5, { width: totalW - 4, align: "center" });
    y += rowH;

    // Draw data rows
    let grandTotal = 0;
    let grandValue = 0;
    let rowAlt = false;

    for (const gk of groupKeys) {
      const g = groups.get(gk)!;
      const groupTotal = g.colours.reduce((sum, c) => sum + g.sizes.reduce((s2, sz) => s2 + (g.qty.get(c)?.get(sz) ?? 0), 0), 0);
      grandTotal += groupTotal;
      if (g.price != null) grandValue += groupTotal * g.price;

      let firstColour = true;
      for (const colour of g.colours) {
        const rowTotal = g.sizes.reduce((s, sz) => s + (g.qty.get(colour)?.get(sz) ?? 0), 0);

        doc.rect(startX, y, tableW, rowH).fill(rowAlt ? "#f8fafc" : "#ffffff").stroke("#e2e8f0");
        doc.fillColor("#1e293b").fontSize(8).font("Helvetica-Bold");

        if (firstColour) {
          doc.text(g.code ?? "—", startX + 4, y + 5, { width: codeW - 4 });
          firstColour = false;
        }
        doc.font("Helvetica").text(colour, startX + codeW + 4, y + 5, { width: colourW - 4 });

        sx = startX + codeW + colourW;
        for (const sz of allSizes) {
          const qty = g.qty.get(colour)?.get(sz) ?? 0;
          doc.text(qty > 0 ? String(qty) : "—", sx + 2, y + 5, { width: sizeW - 4, align: "center" });
          sx += sizeW;
        }
        doc.font("Helvetica-Bold").text(String(rowTotal), sx + 2, y + 5, { width: totalW - 4, align: "center" });

        y += rowH;
        rowAlt = !rowAlt;

        if (y > doc.page.height - 80) {
          doc.addPage();
          y = 50;
        }
      }

      // Group subtotal if more than one colour
      if (g.colours.length > 1) {
        doc.rect(startX, y, tableW, rowH).fill("#e2e8f0");
        doc.fillColor("#1e293b").fontSize(8).font("Helvetica-Bold");
        doc.text("", startX + 4, y + 5, { width: codeW - 4 });
        doc.text("Subtotal", startX + codeW + 4, y + 5, { width: colourW - 4 });
        sx = startX + codeW + colourW;
        for (const sz of allSizes) {
          const colTotal = g.colours.reduce((sum, c) => sum + (g.qty.get(c)?.get(sz) ?? 0), 0);
          doc.text(colTotal > 0 ? String(colTotal) : "—", sx + 2, y + 5, { width: sizeW - 4, align: "center" });
          sx += sizeW;
        }
        doc.text(String(groupTotal), sx + 2, y + 5, { width: totalW - 4, align: "center" });
        y += rowH;
      }
    }

    // Grand total row
    doc.rect(startX, y, tableW, rowH).fill("#1e293b");
    doc.fillColor("#ffffff").fontSize(8).font("Helvetica-Bold");
    doc.text("TOTAL", startX + 4, y + 5, { width: codeW + colourW - 4 });
    sx = startX + codeW + colourW;
    const allSizeTotals = allSizes.map((sz) =>
      groupKeys.reduce((sum, gk) => {
        const g = groups.get(gk)!;
        return sum + g.colours.reduce((s, c) => s + (g.qty.get(c)?.get(sz) ?? 0), 0);
      }, 0)
    );
    for (let i = 0; i < allSizes.length; i++) {
      doc.text(allSizeTotals[i] > 0 ? String(allSizeTotals[i]) : "—", sx + 2, y + 5, { width: sizeW - 4, align: "center" });
      sx += sizeW;
    }
    doc.text(String(grandTotal), sx + 2, y + 5, { width: totalW - 4, align: "center" });
    y += rowH + 12;

    // Summary line
    doc.fillColor("#374151").fontSize(10).font("Helvetica").text(`Total units: ${grandTotal}`, startX, y);
    if (grandValue > 0) {
      doc.text(`  ·  Total value: £${grandValue.toFixed(2)}`, startX + 90, y);
    }

    // Footer
    const footerY = doc.page.height - 40;
    doc.fillColor("#9ca3af").fontSize(8).text("Select Branding Solutions · Effortless uniform management from order to delivery.", 50, footerY, { align: "center", width: W });

    doc.end();
  });
}

export function buildPOEmail(po: POData, extraNotes: string): { subject: string; html: string; text: string } {
  const { groupKeys, groups } = buildMatrix(po.items);
  const dateStr = new Date(po.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const subject = `Purchase Order ${po.poNumber} — Select Branding Solutions`;

  const rowsHtml = groupKeys.map((gk) => {
    const g = groups.get(gk)!;
    return g.colours.map((colour) => {
      const rowTotal = g.sizes.reduce((s, sz) => s + (g.qty.get(colour)?.get(sz) ?? 0), 0);
      const sizeCells = g.sizes.map((sz) => {
        const qty = g.qty.get(colour)?.get(sz) ?? 0;
        return `<td style="padding:6px 10px;text-align:center;border-bottom:1px solid #e5e7eb;">${qty > 0 ? `<strong>${qty}</strong>` : "—"}</td>`;
      }).join("");
      return `<tr>
        <td style="padding:6px 10px;font-family:monospace;border-bottom:1px solid #e5e7eb;">${g.code ?? "—"}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">${colour}</td>
        ${sizeCells}
        <td style="padding:6px 10px;text-align:center;font-weight:700;border-bottom:1px solid #e5e7eb;">${rowTotal}</td>
      </tr>`;
    }).join("");
  }).join("");

  const allSizes: string[] = [];
  for (const gk of groupKeys) for (const s of groups.get(gk)!.sizes) if (!allSizes.includes(s)) allSizes.push(s);
  const sizeHeaders = allSizes.map((s) => `<th style="padding:8px 10px;text-align:center;font-size:12px;color:#6b7280;background:#f8fafc;border-bottom:1px solid #e5e7eb;">${s}</th>`).join("");
  const totalUnits = po.items.reduce((s, i) => s + i.quantityOrdered, 0);
  const totalValue = po.items.reduce((s, i) => s + (i.supplierPrice != null ? i.supplierPrice * i.quantityOrdered : 0), 0);

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="620" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
        <tr><td style="background:#1e293b;padding:24px 32px;">
          <h1 style="margin:0;color:#fff;font-size:18px;font-weight:700;">Select Branding Solutions</h1>
          <p style="margin:4px 0 0;color:#94a3b8;font-size:13px;">Purchase Order — ${po.poNumber}</p>
        </td></tr>
        <tr><td style="padding:28px 32px;">
          <p style="margin:0 0 20px;font-size:15px;color:#374151;">Dear ${po.supplierName},<br><br>Please supply the following items for order <strong>${po.poNumber}</strong> dated ${dateStr}. A detailed PDF is attached for your records.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;border-collapse:collapse;margin-bottom:20px;">
            <thead><tr>
              <th style="padding:8px 10px;text-align:left;font-size:12px;color:#6b7280;background:#f8fafc;border-bottom:1px solid #e5e7eb;">Code</th>
              <th style="padding:8px 10px;text-align:left;font-size:12px;color:#6b7280;background:#f8fafc;border-bottom:1px solid #e5e7eb;">Colour</th>
              ${sizeHeaders}
              <th style="padding:8px 10px;text-align:center;font-size:12px;color:#6b7280;background:#f8fafc;border-bottom:1px solid #e5e7eb;">Total</th>
            </tr></thead>
            <tbody>${rowsHtml}</tbody>
            <tfoot><tr>
              <td colspan="${2 + allSizes.length}" style="padding:10px;text-align:right;font-weight:600;font-size:14px;background:#f8fafc;">Total units</td>
              <td style="padding:10px;text-align:center;font-weight:700;font-size:14px;background:#f8fafc;">${totalUnits}</td>
            </tr>${totalValue > 0 ? `<tr><td colspan="${2 + allSizes.length}" style="padding:10px;text-align:right;font-weight:600;font-size:14px;background:#f8fafc;">Total value</td><td style="padding:10px;text-align:center;font-weight:700;font-size:14px;background:#f8fafc;">£${totalValue.toFixed(2)}</td></tr>` : ""}</tfoot>
          </table>
          ${po.notes || extraNotes ? `<p style="font-size:14px;color:#374151;margin-bottom:20px;"><strong>Notes:</strong> ${[po.notes, extraNotes].filter(Boolean).join(" — ")}</p>` : ""}
          <p style="font-size:14px;color:#374151;margin:0;">Please confirm receipt of this order at your earliest convenience.<br><br>Kind regards,<br><strong>Select Branding Solutions</strong></p>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:14px 32px;border-top:1px solid #e5e7eb;">
          <p style="margin:0;font-size:11px;color:#9ca3af;text-align:center;">Select Branding Solutions · Effortless uniform management from order to delivery.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const lines = [`Dear ${po.supplierName},`, ``, `Please supply the following items for PO ${po.poNumber} (${dateStr}):`, ``];
  for (const gk of groupKeys) {
    const g = groups.get(gk)!;
    lines.push(`${g.productName}${g.code ? ` [${g.code}]` : ""}:`);
    for (const colour of g.colours) {
      const parts = g.sizes.map((sz) => { const q = g.qty.get(colour)?.get(sz) ?? 0; return q > 0 ? `${sz}: ${q}` : null; }).filter(Boolean);
      lines.push(`  ${colour} — ${parts.join(", ")}`);
    }
    lines.push(``);
  }
  if (po.notes || extraNotes) lines.push(`Notes: ${[po.notes, extraNotes].filter(Boolean).join(" — ")}`, ``);
  lines.push(`Kind regards,`, `Select Branding Solutions`);

  return { subject, html, text: lines.join("\n") };
}

// ─── DB-backed SMTP config (for invoice emails) ───────────────────────────────

async function getDbSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  return row?.value ?? null;
}

async function setDbSetting(key: string, value: string | null): Promise<void> {
  await db.insert(settingsTable).values({ key, value })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromEmail: string;
  fromName: string;
}

export async function getSmtpConfig(): Promise<SmtpConfig | null> {
  const host = await getDbSetting("smtp_host");
  const port = await getDbSetting("smtp_port");
  const user = await getDbSetting("smtp_user");
  const pass = await getDbSetting("smtp_pass");
  const fromEmail = await getDbSetting("smtp_from_email");
  const fromName = await getDbSetting("smtp_from_name");
  if (!host || !user || !pass || !fromEmail) return null;
  return {
    host,
    port: port ? parseInt(port, 10) : 587,
    secure: port === "465",
    user,
    pass,
    fromEmail,
    fromName: fromName ?? "Select Branding Solutions",
  };
}

export async function testSmtpConnection(): Promise<{ ok: boolean; error?: string }> {
  const config = await getSmtpConfig();
  if (!config) return { ok: false, error: "SMTP not configured." };
  const t = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    tls: { rejectUnauthorized: false },
  });
  try {
    await t.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Invoice PDF generation ───────────────────────────────────────────────────

interface InvoiceLineItem {
  productName: string;
  colour?: string | null;
  size?: string | null;
  finishName?: string | null;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
}

interface InvoiceData {
  orderNumber: string;
  customerName: string;
  customerEmail?: string | null;
  trackingNumber?: string | null;
  items: InvoiceLineItem[];
  totalAmount: string;
  notes?: string | null;
}

export function generateInvoicePDF(data: InvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const navy = "#1e3a5f";
    const lightGray = "#f5f5f5";
    const darkGray = "#444444";
    const W = doc.page.width - 100;

    // Header
    doc.rect(0, 0, doc.page.width, 80).fill(navy);
    doc.fillColor("white").fontSize(22).font("Helvetica-Bold").text("SELECT BRANDING SOLUTIONS", 50, 22);
    doc.fontSize(9).font("Helvetica").fillColor("rgba(255,255,255,0.7)").text("selectbranding.co.uk", 50, 50);
    doc.fillColor("white").fontSize(18).font("Helvetica-Bold").text("INVOICE", doc.page.width - 150, 28, { width: 100, align: "right" });

    // Invoice details
    let y = 104;
    const details: [string, string][] = [
      ["Invoice Number:", data.orderNumber],
      ["Invoice Date:", new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })],
      ["Payment Due:", new Date(Date.now() + 30 * 86400000).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })],
    ];
    if (data.trackingNumber) details.push(["DPD Tracking:", data.trackingNumber]);

    for (const [label, val] of details) {
      doc.font("Helvetica-Bold").fontSize(9).fillColor(darkGray).text(label, 50, y);
      doc.font("Helvetica").fillColor(label === "DPD Tracking:" ? "#1a56a0" : darkGray).text(val, 160, y);
      y += 16;
    }

    // Bill To
    const billY = 104;
    doc.font("Helvetica-Bold").fontSize(9).fillColor(navy).text("BILL TO", doc.page.width - 220, billY);
    doc.font("Helvetica").fillColor(darkGray).text(data.customerName, doc.page.width - 220, billY + 14);
    if (data.customerEmail) doc.text(data.customerEmail, doc.page.width - 220, billY + 28);

    // Table
    const tableY = y + 14;
    const colQty = 360, colUnit = 420, colTotal = 490;
    doc.rect(50, tableY, W, 22).fill(navy);
    doc.fillColor("white").fontSize(8.5).font("Helvetica-Bold");
    doc.text("Description", 56, tableY + 6, { width: 295 });
    doc.text("Qty", colQty, tableY + 6, { width: 55, align: "right" });
    doc.text("Unit Price", colUnit, tableY + 6, { width: 65, align: "right" });
    doc.text("Total", colTotal, tableY + 6, { width: 55, align: "right" });

    let rowY = tableY + 22;
    doc.font("Helvetica").fontSize(9).fillColor(darkGray);
    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i];
      if (i % 2 === 0) doc.rect(50, rowY, W, 20).fill(lightGray);
      const desc = [item.productName, item.colour, item.size, item.finishName ? `[${item.finishName}]` : null].filter(Boolean).join(" – ");
      doc.fillColor(darkGray);
      doc.text(desc, 56, rowY + 5, { width: 295 });
      doc.text(String(item.quantity), colQty, rowY + 5, { width: 55, align: "right" });
      doc.text(`£${parseFloat(item.unitPrice).toFixed(2)}`, colUnit, rowY + 5, { width: 65, align: "right" });
      doc.text(`£${parseFloat(item.lineTotal).toFixed(2)}`, colTotal, rowY + 5, { width: 55, align: "right" });
      rowY += 20;
    }
    doc.rect(50, tableY, W, rowY - tableY).stroke("#cccccc");

    // Totals
    rowY += 12;
    const subtotal = parseFloat(data.totalAmount);
    const vat = subtotal * 0.2;
    const totX = doc.page.width - 220;
    doc.font("Helvetica").fontSize(10).fillColor(darkGray);
    doc.text("Subtotal:", totX, rowY, { width: 100 }); doc.text(`£${subtotal.toFixed(2)}`, totX + 100, rowY, { width: 65, align: "right" }); rowY += 18;
    doc.text("VAT (20%):", totX, rowY, { width: 100 }); doc.text(`£${vat.toFixed(2)}`, totX + 100, rowY, { width: 65, align: "right" }); rowY += 8;
    doc.rect(totX, rowY, 165, 1).fill("#cccccc"); rowY += 8;
    doc.font("Helvetica-Bold").fontSize(12).fillColor(navy);
    doc.text("TOTAL:", totX, rowY, { width: 100 }); doc.text(`£${(subtotal + vat).toFixed(2)}`, totX + 100, rowY, { width: 65, align: "right" }); rowY += 40;

    // Terms box
    doc.rect(50, rowY, W, 46).fill(lightGray).stroke("#dddddd");
    doc.font("Helvetica-Bold").fontSize(9).fillColor(navy).text("Payment Terms", 60, rowY + 8);
    doc.font("Helvetica").fillColor(darkGray).text("Payment is due within 30 days of invoice date. Please reference the invoice number when making payment.", 60, rowY + 22, { width: W - 20 });

    // Footer
    doc.rect(0, doc.page.height - 40, doc.page.width, 40).fill(navy);
    doc.fillColor("rgba(255,255,255,0.6)").fontSize(8).font("Helvetica")
      .text("Select Branding Solutions  |  selectbranding.co.uk", 0, doc.page.height - 26, { align: "center", width: doc.page.width });

    doc.end();
  });
}

// ─── Send Invoice Email ───────────────────────────────────────────────────────

export async function sendInvoiceEmail(orderId: number): Promise<{ sentTo: string }> {
  const config = await getSmtpConfig();
  if (!config) throw new Error("SMTP not configured. Go to Settings → Email to set up.");

  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!order) throw new Error("Order not found.");

  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));

  let customerEmail: string | null = null;
  if (order.customerId) {
    const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, order.customerId));
    customerEmail = (customer as any)?.email ?? null;
  }
  if (!customerEmail) throw new Error("Customer has no email address on record.");

  const pdfBuffer = await generateInvoicePDF({
    orderNumber: order.orderNumber,
    customerName: order.customerName ?? "Customer",
    customerEmail,
    trackingNumber: order.trackingNumber,
    items: items.map((i) => ({
      productName: i.productName,
      colour: i.colour,
      size: i.size,
      finishName: i.finishName,
      quantity: i.quantity,
      unitPrice: i.unitPrice as string,
      lineTotal: i.lineTotal as string,
    })),
    totalAmount: order.totalAmount as string,
    notes: order.notes,
  });

  const trackingHtml = order.trackingNumber ? `
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:16px;margin:16px 0;">
      <p style="margin:0 0 6px;font-weight:bold;color:#1e40af;">📦 Your order is on its way!</p>
      <p style="margin:0 0 4px;color:#374151;">Tracking number: <strong>${order.trackingNumber}</strong></p>
      <a href="https://track.dpd.co.uk/parcels/${order.trackingNumber}" style="color:#1d4ed8;">Track your parcel on DPD →</a>
    </div>` : "";

  const trackingText = order.trackingNumber
    ? `\nYour order is on its way!\nTracking: ${order.trackingNumber}\nhttps://track.dpd.co.uk/parcels/${order.trackingNumber}\n`
    : "";

  const t = nodemailer.createTransport({
    host: config.host, port: config.port, secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    tls: { rejectUnauthorized: false },
  });

  const total = parseFloat(order.totalAmount as string);

  await t.sendMail({
    from: `"${config.fromName}" <${config.fromEmail}>`,
    to: customerEmail,
    subject: `Invoice ${order.orderNumber} – Select Branding Solutions`,
    text: [
      `Dear ${order.customerName ?? "Customer"},`,
      ``,
      `Please find your invoice attached for order ${order.orderNumber}.`,
      ``,
      `Invoice Total: £${(total * 1.2).toFixed(2)} (inc. VAT)`,
      `Payment Due: ${new Date(Date.now() + 30 * 86400000).toLocaleDateString("en-GB")}`,
      trackingText,
      `If you have any questions, please don't hesitate to get in touch.`,
      ``,
      `Kind regards,`,
      config.fromName,
      `Select Branding Solutions`,
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#1e3a5f;padding:24px;border-radius:8px 8px 0 0;">
          <h1 style="color:white;margin:0;font-size:20px;">Select Branding Solutions</h1>
        </div>
        <div style="padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
          <p>Dear ${order.customerName ?? "Customer"},</p>
          <p>Please find your invoice attached for order <strong>${order.orderNumber}</strong>.</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0;">
            <tr style="background:#f9fafb;">
              <td style="padding:8px 12px;font-weight:bold;">Invoice Total</td>
              <td style="padding:8px 12px;text-align:right;">£${(total * 1.2).toFixed(2)} <span style="color:#6b7280;font-size:12px;">(inc. VAT)</span></td>
            </tr>
            <tr>
              <td style="padding:8px 12px;font-weight:bold;">Payment Due</td>
              <td style="padding:8px 12px;text-align:right;">${new Date(Date.now() + 30 * 86400000).toLocaleDateString("en-GB")}</td>
            </tr>
          </table>
          ${trackingHtml}
          <p>If you have any questions about this invoice, please don't hesitate to get in touch.</p>
          <p>Kind regards,<br><strong>${config.fromName}</strong><br>Select Branding Solutions</p>
        </div>
      </div>`,
    attachments: [{ filename: `Invoice-${order.orderNumber}.pdf`, content: pdfBuffer, contentType: "application/pdf" }],
  });

  await db.update(ordersTable)
    .set({ invoiceEmailSentAt: new Date(), invoiceEmailSentTo: customerEmail, updatedAt: new Date() })
    .where(eq(ordersTable.id, orderId));

  return { sentTo: customerEmail };
}
