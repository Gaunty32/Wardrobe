import nodemailer from "nodemailer";
import PDFDocument from "pdfkit";
import { db, settingsTable, ordersTable, orderItemsTable, customersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { SBS_LOGO_DATA_URL } from "../assets/logo-data";
import { getResendClient } from "./resend-client.js";

// ── SBS logo buffer for PDFKit (extracted from data URL) ─────────────────────
const SBS_LOGO_BUFFER: Buffer | null = (() => {
  try { return Buffer.from(SBS_LOGO_DATA_URL.split(",")[1], "base64"); } catch { return null; }
})();

// ── Logo fetch helpers ────────────────────────────────────────────────────────
export async function fetchLogoBuffer(url: string | null | undefined): Promise<Buffer | null> {
  if (!url) return null;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;
    return Buffer.from(await resp.arrayBuffer());
  } catch { return null; }
}

export async function fetchLogoDataUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;
    const ct = resp.headers.get("content-type") ?? "image/png";
    return `data:${ct};base64,${Buffer.from(await resp.arrayBuffer()).toString("base64")}`;
  } catch { return null; }
}

function toFirstName(name: string | null | undefined): string {
  if (!name?.trim()) return "there";
  const first = name.trim().split(/\s+/)[0];
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

// Resend is available when the Replit Connectors proxy is present
const isResendAvailable = !!(process.env.REPLIT_CONNECTORS_HOSTNAME);

const isSmtpConfigured = !!(
  process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
);

// isEmailConfigured = true if either Resend or SMTP is available
export const isEmailConfigured = isResendAvailable || isSmtpConfigured;

const smtpTransporter = isSmtpConfigured
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT ?? "587"),
      secure: process.env.SMTP_SECURE === "true",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

// ── SBS contact details ──────────────────────────────────────────────────────
const SBS_PHONE_DISPLAY = "0113 246 0000"; // ← update with real number
const SBS_PHONE_HREF    = "tel:+441132460000"; // ← update with real number
const SBS_WHATSAPP_URL  = "https://wa.me/441132460000"; // ← update with real WhatsApp number
const SBS_CHAT_URL      = "https://wardrobe.selectbranding.co.uk/customer-portal";
// ─────────────────────────────────────────────────────────────────────────────

const SBS_FROM = "Select Branding Solutions <info@selectbranding.co.uk>";
const DEFAULT_FROM = process.env.SMTP_FROM ?? SBS_FROM;

export async function sendEmail(opts: {
  to: string;
  cc?: string | string[];
  subject: string;
  html: string;
  text: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
}): Promise<{ sent: boolean; error?: string }> {

  // ── Resend (preferred) ──────────────────────────────────────────────────────
  if (isResendAvailable) {
    try {
      const { client } = await getResendClient();
      const from = SBS_FROM;
      const ccArr = opts.cc
        ? (Array.isArray(opts.cc) ? opts.cc : [opts.cc])
        : undefined;
      const { error } = await client.emails.send({
        from,
        to: [opts.to],
        ...(ccArr?.length ? { cc: ccArr } : {}),
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
        attachments: opts.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
        })),
      });
      if (error) return { sent: false, error: error.message };
      return { sent: true };
    } catch (err: any) {
      // If connector fails for any reason, fall through to SMTP
      console.error("[email] Resend failed, trying SMTP fallback:", err.message);
    }
  }

  // ── SMTP fallback ───────────────────────────────────────────────────────────
  if (!smtpTransporter) return { sent: false, error: "Email not configured" };
  try {
    await smtpTransporter.sendMail({ from: DEFAULT_FROM, ...opts });
    return { sent: true };
  } catch (err: any) {
    return { sent: false, error: err.message };
  }
}

export function buildAcknowledgementEmail(order: {
  orderNumber: string;
  customerName: string | null;
  contactFirstName?: string | null;
  customerLogoDataUrl?: string | null;
  shippingMethod?: string | null;
  orderDate: Date | null;
  requiredDate?: Date | null;
  notes?: string | null;
  totalAmount?: number | null;
  stripePaymentLink?: string | null;
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
  const subject = `Order Acknowledged — Ref ${order.orderNumber} | Select Branding Solutions`;

  const stripeLink = order.stripePaymentLink ?? "https://buy.stripe.com/bIY16peJJ5j99Us144";
  const firstName = toFirstName(order.contactFirstName ?? order.customerName);

  const itemRows = order.items
    .map(
      (i) =>
        `<tr>
          <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#1e293b;">${i.productName}${i.finishName ? `<br><span style="font-size:11px;color:#6366f1;font-weight:600;">Finish: ${i.finishName}</span>` : ""}${i.recipientName ? `<br><span style="font-size:11px;color:#94a3b8;">For: ${i.recipientName}</span>` : ""}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b;">${[i.colour, i.size].filter(Boolean).join(" / ") || "—"}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;text-align:center;font-size:13px;font-weight:600;color:#1e293b;">${i.quantity}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;text-align:right;font-size:13px;color:#64748b;">£${i.unitPrice.toFixed(2)}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;text-align:right;font-size:13px;font-weight:700;color:#1e293b;">£${i.lineTotal.toFixed(2)}</td>
        </tr>`
    )
    .join("\n");

  const subtotal = order.totalAmount ?? order.items.reduce((s, i) => s + i.lineTotal, 0);
  const vatAmount = subtotal * 0.2;
  const totalIncVat = subtotal + vatAmount;

  const customerLogoBlock = order.customerLogoDataUrl
    ? `<td style="vertical-align:middle;text-align:right;">
        <p style="margin:0 0 6px;color:#64748b;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Prepared for</p>
        <img src="${order.customerLogoDataUrl}" alt="${order.customerName ?? "Customer"}" height="38" style="display:block;height:38px;width:auto;max-width:130px;margin-left:auto;" />
      </td>`
    : `<td style="vertical-align:middle;text-align:right;">
        <p style="margin:0;color:#94a3b8;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Order Acknowledgement</p>
        <p style="margin:4px 0 0;color:#fff;font-size:17px;font-weight:700;">Ref: ${order.orderNumber}</p>
      </td>`;

  const orderRefSubBar = order.customerLogoDataUrl
    ? `<tr><td style="background:#0f172a;padding:10px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td><p style="margin:0;color:#64748b;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Order Acknowledgement</p>
          <p style="margin:2px 0 0;color:#fff;font-size:15px;font-weight:700;">Ref: ${order.orderNumber}</p></td>
        </tr></table>
      </td></tr>`
    : "";

  const SHIPPING_LABELS: Record<string, string> = {
    free_local: "Free Local Delivery",
    dpd: "DPD Courier", royal_mail: "Royal Mail", local_delivery: "Local Delivery",
    office_collection: "Office Collection", warehouse_collection: "Collection from our warehouse", courier: "Courier",
    dpd_next_day: "Next Day DPD",
  };
  const shippingLabel = order.shippingMethod ? (SHIPPING_LABELS[order.shippingMethod] ?? order.shippingMethod) : null;
  const isFreeLocal = order.shippingMethod === "free_local";

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="620" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.10);">

        <!-- Header: dark bar with SBS logo + customer logo or order ref -->
        <tr><td style="background:#1e293b;padding:22px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:middle;">
              <img src="${SBS_LOGO_DATA_URL}" alt="Select Branding Solutions" height="48" style="display:block;height:48px;width:auto;" />
            </td>
            ${customerLogoBlock}
          </tr></table>
        </td></tr>
        ${orderRefSubBar}

        <!-- Greeting band: solid navy (gradients unreliable in email) -->
        <tr><td style="background:#1e3a5f;padding:24px 32px;">
          <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;line-height:1.3;">Thank you, ${firstName}!</p>
          <p style="margin:6px 0 0;font-size:14px;color:#93c5fd;line-height:1.5;">We're delighted to have received your order and can't wait to get started.</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:28px 32px 0;">
          <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.7;">
            We've put together the details below for your records. Please check everything looks right — particularly the garments, colours, sizes and any finishes. If anything needs adjusting, just get in touch and we'll sort it straight away.
          </p>
        </td></tr>

        <!-- Items table -->
        <tr><td style="padding:0 32px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:collapse;overflow:hidden;">
            <thead>
              <tr style="background:#1e293b;">
                <th style="padding:10px 12px;text-align:left;font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Product</th>
                <th style="padding:10px 12px;text-align:left;font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Colour / Size</th>
                <th style="padding:10px 12px;text-align:center;font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Qty</th>
                <th style="padding:10px 12px;text-align:right;font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Unit</th>
                <th style="padding:10px 12px;text-align:right;font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Total</th>
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
            <tfoot>
              <tr style="background:#f8fafc;">
                <td colspan="4" style="padding:10px 12px;text-align:right;font-size:12px;color:#64748b;border-top:1px solid #e2e8f0;">Subtotal (exc. VAT)</td>
                <td style="padding:10px 12px;text-align:right;font-size:13px;font-weight:600;color:#1e293b;border-top:1px solid #e2e8f0;">£${subtotal.toFixed(2)}</td>
              </tr>
              <tr style="background:#f8fafc;">
                <td colspan="4" style="padding:6px 12px;text-align:right;font-size:12px;color:#64748b;border-top:1px solid #e2e8f0;">VAT (20%)</td>
                <td style="padding:6px 12px;text-align:right;font-size:13px;color:#64748b;border-top:1px solid #e2e8f0;">£${vatAmount.toFixed(2)}</td>
              </tr>
              <tr style="background:#1e293b;">
                <td colspan="4" style="padding:12px;text-align:right;font-size:13px;font-weight:700;color:#ffffff;letter-spacing:0.3px;">Total (inc. VAT)</td>
                <td style="padding:12px;text-align:right;font-size:15px;font-weight:800;color:#ffffff;">£${totalIncVat.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        </td></tr>

        ${order.notes ? `<tr><td style="padding:0 32px 16px;"><div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:12px 16px;"><p style="margin:0;font-size:13px;color:#92400e;"><strong>Order notes:</strong> ${order.notes}</p></div></td></tr>` : ""}

        <!-- Payment section -->
        <tr><td style="padding:0 32px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:collapse;overflow:hidden;">
            <tr><td style="background:#f8fafc;padding:14px 18px;border-bottom:1px solid #e2e8f0;">
              <p style="margin:0;font-size:13px;font-weight:700;color:#1e293b;text-transform:uppercase;letter-spacing:0.5px;">Payment Options</p>
              <p style="margin:4px 0 0;font-size:13px;color:#64748b;">Pay securely by card online or by BACS transfer.</p>
            </td></tr>
            <tr><td style="padding:16px 18px;">
              <!-- Pay by card button: solid background (gradients unreliable in email) -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
                <tr><td style="background:#1e3a5f;border-radius:6px;">
                  <a href="${stripeLink}" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:0.3px;">
                    Pay by Card Online &#8594;
                  </a>
                </td></tr>
              </table>
              <!-- BACS details -->
              <table cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:6px;border-collapse:collapse;min-width:260px;">
                <tr style="background:#f1f5f9;">
                  <td colspan="2" style="padding:8px 12px;font-size:10px;font-weight:700;color:#64748b;letter-spacing:0.8px;text-transform:uppercase;border-bottom:1px solid #e2e8f0;">BACS Bank Transfer</td>
                </tr>
                <tr>
                  <td style="padding:7px 12px;font-size:12px;color:#64748b;white-space:nowrap;">Account name</td>
                  <td style="padding:7px 12px;font-size:12px;font-weight:600;color:#1e293b;">Select Branding Solutions Ltd</td>
                </tr>
                <tr style="background:#f8fafc;">
                  <td style="padding:7px 12px;font-size:12px;color:#64748b;white-space:nowrap;">Sort code</td>
                  <td style="padding:7px 12px;font-size:12px;font-weight:600;color:#1e293b;font-family:monospace;">04-06-05</td>
                </tr>
                <tr>
                  <td style="padding:7px 12px;font-size:12px;color:#64748b;white-space:nowrap;">Account number</td>
                  <td style="padding:7px 12px;font-size:12px;font-weight:600;color:#1e293b;font-family:monospace;">30422879</td>
                </tr>
              </table>
            </td></tr>
          </table>
        </td></tr>

        <!-- Shipping method -->
        ${shippingLabel ? `<tr><td style="padding:0 32px 12px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:collapse;overflow:hidden;">
            <tr><td style="background:#f8fafc;padding:10px 18px;border-bottom:1px solid #e2e8f0;">
              <p style="margin:0;font-size:13px;font-weight:700;color:#1e293b;text-transform:uppercase;letter-spacing:0.5px;">Shipping &amp; Collection</p>
            </td></tr>
            <tr><td style="padding:10px 18px;">
              <p style="margin:0;font-size:13px;font-weight:600;color:#374151;">${shippingLabel}</p>
              ${isFreeLocal ? `<p style="margin:6px 0 0;font-size:12px;color:#4b5563;line-height:1.6;">As you are local to us we offer free delivery to your postcode on a <strong>Tuesday</strong> and a <strong>Friday</strong>. We will let you know on the morning of your delivery and you can expect to see Tim with your order before lunchtime!</p>` : ""}
            </td></tr>
          </table>
        </td></tr>` : ""}

        <!-- Contact details -->
        <tr><td style="padding:0 32px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #dbeafe;border-radius:8px;border-collapse:collapse;overflow:hidden;">
            <tr><td style="background:#eff6ff;padding:12px 18px;border-bottom:1px solid #dbeafe;">
              <p style="margin:0;font-size:13px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:0.5px;">Need Help? We're Here For You</p>
            </td></tr>
            <tr><td style="padding:14px 18px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:5px 0;width:50%;vertical-align:top;">
                    <p style="margin:0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">Email</p>
                    <a href="mailto:info@selectbranding.co.uk" style="font-size:13px;color:#1d4ed8;text-decoration:none;font-weight:500;">info@selectbranding.co.uk</a>
                  </td>
                  <td style="padding:5px 0;width:50%;vertical-align:top;">
                    <p style="margin:0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">Phone</p>
                    <a href="${SBS_PHONE_HREF}" style="font-size:13px;color:#1e293b;text-decoration:none;font-weight:500;">${SBS_PHONE_DISPLAY}</a>
                  </td>
                </tr>
                <tr>
                  <td style="padding:5px 0;vertical-align:top;">
                    <p style="margin:0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">WhatsApp</p>
                    <a href="${SBS_WHATSAPP_URL}" style="font-size:13px;color:#16a34a;text-decoration:none;font-weight:500;">Message us on WhatsApp</a>
                  </td>
                  <td style="padding:5px 0;vertical-align:top;">
                    <p style="margin:0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">Live Chat</p>
                    <a href="${SBS_CHAT_URL}" style="font-size:13px;color:#1d4ed8;text-decoration:none;font-weight:500;">Chat on our website</a>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </td></tr>

        <!-- Closing -->
        <tr><td style="padding:0 32px 28px;">
          <p style="font-size:14px;color:#374151;margin:0 0 16px;line-height:1.7;">
            Our team will keep you updated as your order progresses. Please don't hesitate to contact us any time — we're always happy to help.
          </p>
          <p style="font-size:14px;color:#374151;margin:0;line-height:1.6;">
            With warm regards,<br>
            <strong style="color:#1e293b;font-size:15px;">The Select Branding Solutions Team</strong>
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f8fafc;padding:14px 32px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:11px;color:#94a3b8;text-align:center;line-height:1.8;">
            Select Branding Solutions Ltd &middot; Spence Mills, Mill Lane, Leeds, LS13 3HE<br>
            <a href="https://www.selectbranding.co.uk" style="color:#94a3b8;text-decoration:none;">www.selectbranding.co.uk</a>
            &middot; <a href="mailto:info@selectbranding.co.uk" style="color:#94a3b8;text-decoration:none;">info@selectbranding.co.uk</a>
            &middot; <a href="${SBS_PHONE_HREF}" style="color:#94a3b8;text-decoration:none;">${SBS_PHONE_DISPLAY}</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    `Order Acknowledged — Ref ${order.orderNumber} | Select Branding Solutions`,
    ``,
    `Hi ${firstName},`,
    ``,
    `Thank you so much for your order — we're delighted to be working with you!`,
    ``,
    `Your order reference is ${order.orderNumber}. Please take a moment to check everything below looks right — garments, colours, sizes and finishes. If anything needs adjusting, just say the word.`,
    ``,
    `ITEMS:`,
    ...order.items.map(
      (i) =>
        `  ${i.productName}${[i.colour, i.size].filter(Boolean).length ? ` (${[i.colour, i.size].filter(Boolean).join(", ")})` : ""}${i.recipientName ? ` — For: ${i.recipientName}` : ""} – Qty: ${i.quantity} @ £${i.unitPrice.toFixed(2)} = £${i.lineTotal.toFixed(2)}`
    ),
    ``,
    ``,
    `Subtotal (exc. VAT): £${subtotal.toFixed(2)}`,
    `VAT (20%):           £${vatAmount.toFixed(2)}`,
    `Total (inc. VAT):    £${totalIncVat.toFixed(2)}`,
    ``,
    `PAYMENT OPTIONS:`,
    `  Pay by card online: ${stripeLink}`,
    ``,
    `  BACS Transfer:`,
    `    Account name:   Select Branding Solutions Ltd`,
    `    Sort code:      04-06-05`,
    `    Account number: 30422879`,
    ``,
    order.notes ? `Order notes: ${order.notes}\n` : null,
    `CONTACT US:`,
    `  Email:     info@selectbranding.co.uk`,
    `  Phone:     ${SBS_PHONE_DISPLAY}`,
    `  WhatsApp:  ${SBS_WHATSAPP_URL}`,
    `  Chat:      ${SBS_CHAT_URL}`,
    ``,
    `Our team will keep you updated as your order progresses. Please reach out any time — we're always happy to help.`,
    ``,
    `With warm regards,`,
    `The Select Branding Solutions Team`,
    `info@selectbranding.co.uk | ${SBS_PHONE_DISPLAY}`,
  ]
    .filter((l) => l !== null)
    .join("\n");

  return { subject, html, text };
}

// ─── Order Acknowledgement PDF ────────────────────────────────────────────────

export interface AckOrderItem {
  productName: string;
  sku?: string | null;
  colour?: string | null;
  size?: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface AckOrderData {
  orderNumber: string;
  orderDate: Date | string | null;
  requiredDate?: Date | string | null;
  poNumber?: string | null;
  customerRef?: string | null;
  customerName: string | null;
  customerAddress?: string | null;
  customerCity?: string | null;
  customerPostcode?: string | null;
  deliveryAddress?: string | null;
  shippingMethod?: string | null;
  customerLogoBuffer?: Buffer | null;
  totalAmount?: number | null;
  shippingAmount?: number | null;
  vatRate?: number;
  items: AckOrderItem[];
}

export async function generateOrderAcknowledgementPdf(order: AckOrderData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 32, size: "A4", autoFirstPage: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const margin = 32;
    const contentW = pageW - margin * 2;

    const fmtDate = (d: Date | string | null | undefined) =>
      d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";

    // ── Header bar (with logos) ───────────────────────────────────────────────
    const hdrH = 52;
    doc.rect(margin, margin, contentW, hdrH).fill("#1e293b");

    // SBS logo (left side of header)
    if (SBS_LOGO_BUFFER) {
      try { doc.image(SBS_LOGO_BUFFER, margin + 8, margin + 6, { fit: [110, 40], valign: "center" }); } catch {}
    }

    // "Order Acknowledgement" title centred in remaining space
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#ffffff")
      .text("Order Acknowledgement", margin + 130, margin + 13, { width: contentW - 260, align: "center" });

    // Customer logo (right side of header)
    if (order.customerLogoBuffer) {
      try { doc.image(order.customerLogoBuffer, margin + contentW - 100, margin + 6, { fit: [92, 40], align: "right", valign: "center" }); } catch {}
    }

    // ── Customer address + SBS contact (two columns) ──────────────────────
    const addrY = margin + hdrH + 8;
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#111827").text(order.customerName ?? "", margin, addrY);
    const addrLines = [order.customerAddress, order.customerCity, order.customerPostcode].filter(Boolean) as string[];
    doc.font("Helvetica").fontSize(8).fillColor("#444444");
    addrLines.forEach((line, i) => doc.text(line, margin, addrY + 11 + i * 10));

    const sbsX = margin + contentW - 170;
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#111827").text("Select Branding Solutions Ltd", sbsX, addrY, { width: 170, align: "right" });
    doc.font("Helvetica").fontSize(7.5).fillColor("#555555");
    doc.text(`Tel: ${SBS_PHONE_DISPLAY}  ·  info@selectbranding.co.uk`, sbsX, addrY + 11, { width: 170, align: "right" });
    doc.text("www.selectbranding.co.uk", sbsX, addrY + 21, { width: 170, align: "right" });

    // ── Divider ───────────────────────────────────────────────────────────────
    const divY = addrY + 11 + Math.max(addrLines.length, 2) * 10 + 8;
    doc.moveTo(margin, divY).lineTo(margin + contentW, divY).strokeColor("#d1d5db").lineWidth(0.5).stroke();

    // ── Order info strip ──────────────────────────────────────────────────────
    const infoY = divY + 5;
    const infoCols = [
      { label: "Order Date", value: fmtDate(order.orderDate) },
      { label: "Account No", value: order.customerRef ?? "—" },
      { label: "Required By", value: fmtDate(order.requiredDate) },
      { label: "Cust PO Ref", value: order.poNumber ?? "—" },
      { label: "Order Ref", value: order.orderNumber },
    ];
    const colW = contentW / infoCols.length;
    infoCols.forEach(({ label, value }, i) => {
      const x = margin + i * colW;
      doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#6b7280").text(label, x, infoY, { width: colW - 4 });
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#111827").text(value, x, infoY + 9, { width: colW - 4 });
    });

    // ── Items table ───────────────────────────────────────────────────────────
    type Group = {
      productName: string;
      sku: string | null;
      finishName: string | null;
      unitPrice: number;
      colours: string[];
      sizes: string[];
      qty: Map<string, Map<string, number>>;
      lineTotal: number;
    };
    const groupKeys: string[] = [];
    const groups = new Map<string, Group>();
    const allSizes: string[] = [];

    for (const item of order.items) {
      const gk = `${item.productName}||${item.finishName ?? ""}`;
      if (!groups.has(gk)) {
        groupKeys.push(gk);
        groups.set(gk, { productName: item.productName, sku: item.sku ?? null, finishName: item.finishName ?? null, unitPrice: item.unitPrice, colours: [], sizes: [], qty: new Map(), lineTotal: 0 });
      }
      const g = groups.get(gk)!;
      const c = item.colour ?? "—";
      const s = item.size ?? "One Size";
      if (!g.colours.includes(c)) g.colours.push(c);
      if (!g.sizes.includes(s)) g.sizes.push(s);
      if (!allSizes.includes(s)) allSizes.push(s);
      if (!g.qty.has(c)) g.qty.set(c, new Map());
      g.qty.get(c)!.set(s, (g.qty.get(c)!.get(s) ?? 0) + item.quantity);
      g.lineTotal += item.lineTotal;
    }

    const tableStartY = infoY + 26;
    const rowH = 13;
    const tblHdrH = 14;

    const colourW    = 76;
    const unitPriceW = 44;
    const totalW     = 48;
    const qtyW       = 28;
    // Size columns: cap at 36pt each so they don't get absurdly wide with few sizes
    const sizeColW   = allSizes.length > 0 ? Math.min(36, Math.floor((contentW * 0.28) / allSizes.length)) : 36;
    const sizeW      = sizeColW * Math.max(allSizes.length, 1);
    // itemName absorbs all remaining space so the table always spans the full content width
    const itemNameW  = contentW - colourW - sizeW - qtyW - unitPriceW - totalW;
    const tableW     = contentW;

    const drawTableHeader = (ty: number) => {
      doc.rect(margin, ty, tableW, tblHdrH).fill("#1e293b");
      doc.fillColor("#94a3b8").fontSize(6.5).font("Helvetica-Bold");
      let hx = margin;
      doc.text("ITEM", hx + 3, ty + 4, { width: itemNameW - 3 }); hx += itemNameW;
      doc.text("COLOUR", hx + 3, ty + 4, { width: colourW - 3 }); hx += colourW;
      for (const sz of allSizes) {
        doc.text(sz, hx + 2, ty + 4, { width: sizeColW - 2, align: "center" }); hx += sizeColW;
      }
      doc.text("QTY", hx + 2, ty + 4, { width: qtyW - 2, align: "center" }); hx += qtyW;
      doc.text("UNIT", hx + 2, ty + 4, { width: unitPriceW - 2, align: "right" }); hx += unitPriceW;
      doc.text("TOTAL", hx + 2, ty + 4, { width: totalW - 2, align: "right" });
    };

    drawTableHeader(tableStartY);
    let y = tableStartY + tblHdrH;
    let rowAlt = false;

    for (const gk of groupKeys) {
      const g = groups.get(gk)!;

      // Product name row (taller when finish is present to fit two lines)
      const productRowH = g.finishName ? rowH + 9 : rowH;
      doc.rect(margin, y, tableW, productRowH).fill("#f0f4f8");
      doc.fillColor("#111827").fontSize(7).font("Helvetica-Bold");
      const productLabel = g.sku ? `${g.sku}  ${g.productName}` : g.productName;
      doc.text(productLabel, margin + 3, y + 3, { width: tableW - totalW - 6 });
      doc.text(`£${g.lineTotal.toFixed(2)}`, margin + tableW - totalW, y + 3, { width: totalW - 3, align: "right" });
      if (g.finishName) {
        doc.fillColor("#4f46e5").fontSize(6.5).font("Helvetica-Oblique")
          .text(`Finish: ${g.finishName}`, margin + 3, y + 12, { width: tableW - totalW - 6 });
      }
      y += productRowH;

      // Colour rows
      for (const colour of g.colours) {
        const rowTotal = allSizes.reduce((s, sz) => s + (g.qty.get(colour)?.get(sz) ?? 0), 0);
        doc.rect(margin, y, tableW, rowH).fill(rowAlt ? "#f9fafb" : "#ffffff").stroke("#e5e7eb");
        doc.fillColor("#374151").fontSize(7).font("Helvetica");
        let rx = margin;
        doc.text("", rx + 3, y + 3, { width: itemNameW - 3 }); rx += itemNameW;
        doc.text(colour, rx + 3, y + 3, { width: colourW - 3 }); rx += colourW;
        for (const sz of allSizes) {
          const q = g.qty.get(colour)?.get(sz) ?? 0;
          doc.text(q > 0 ? String(q) : "", rx + 2, y + 3, { width: sizeColW - 2, align: "center" });
          rx += sizeColW;
        }
        doc.font("Helvetica-Bold").text(String(rowTotal), rx + 2, y + 3, { width: qtyW - 2, align: "center" }); rx += qtyW;
        doc.font("Helvetica").text(`£${g.unitPrice.toFixed(2)}`, rx + 2, y + 3, { width: unitPriceW - 2, align: "right" }); rx += unitPriceW;
        doc.text("", rx + 2, y + 3, { width: totalW - 3, align: "right" });
        y += rowH;
        rowAlt = !rowAlt;
      }

      // Page break — re-draw header on new page
      if (y > pageH - 120) {
        doc.addPage();
        y = margin;
        drawTableHeader(y);
        y += tblHdrH;
        rowAlt = false;
      }
    }

    // ── Totals ────────────────────────────────────────────────────────────────
    const pdfSubtotal = order.totalAmount ?? order.items.reduce((s, i) => s + i.lineTotal, 0);
    const pdfShipping = order.shippingAmount ?? 0;
    const pdfVatRate  = order.vatRate ?? 0.20;
    const pdfVat      = (pdfSubtotal + pdfShipping) * pdfVatRate;
    const pdfGrand    = pdfSubtotal + pdfShipping + pdfVat;

    const totalsX = margin + tableW - 195;
    const totalsW = 195;
    y += 6;

    const totalsRows: { label: string; value: string; bold?: boolean; big?: boolean }[] = [
      { label: "Subtotal (exc. VAT):", value: `£${pdfSubtotal.toFixed(2)}` },
      ...(pdfShipping > 0 ? [{ label: "Shipping & Handling:", value: `£${pdfShipping.toFixed(2)}` }] : []),
      { label: `VAT (${Math.round(pdfVatRate * 100)}%):`, value: `£${pdfVat.toFixed(2)}` },
      { label: "TOTAL (inc. VAT):", value: `£${pdfGrand.toFixed(2)}`, bold: true, big: true },
    ];

    doc.fontSize(7.5);
    for (const row of totalsRows) {
      const rowBg = row.big ? "#1e293b" : "#f8fafc";
      const fg    = row.big ? "#ffffff" : "#111827";
      const rH    = row.big ? 16 : 13;
      doc.rect(totalsX, y, totalsW, rH).fill(rowBg).stroke("#e5e7eb");
      doc.fillColor(fg).font(row.bold ? "Helvetica-Bold" : "Helvetica");
      doc.text(row.label, totalsX + 4, y + (row.big ? 4 : 3), { width: 120 });
      doc.font("Helvetica-Bold").text(row.value, totalsX + 124, y + (row.big ? 4 : 3), { width: totalsW - 128, align: "right" });
      y += rH;
    }

    // ── Shipping / delivery section ───────────────────────────────────────────
    const SHIP_LABELS: Record<string, string> = {
      free_local: "Free Local Delivery",
      dpd: "DPD Courier", royal_mail: "Royal Mail", local_delivery: "Local Delivery",
      office_collection: "Office Collection", warehouse_collection: "Collection from our warehouse", courier: "Courier",
      dpd_next_day: "Next Day DPD",
    };
    const isCollection = order.shippingMethod
      ? ["office_collection", "warehouse_collection"].includes(order.shippingMethod)
      : false;
    const shipLabel = order.shippingMethod ? (SHIP_LABELS[order.shippingMethod] ?? order.shippingMethod) : null;

    if (shipLabel) {
      y += 10;
      doc.fillColor("#555555").fontSize(7.5).font("Helvetica-Bold").text("Shipping / Collection:", margin, y);
      y += 10;
      doc.font("Helvetica").fontSize(7.5).fillColor("#374151").text(shipLabel, margin, y, { width: 250 });
      if (order.shippingMethod === "free_local") {
        y += 11;
        doc.font("Helvetica").fontSize(7).fillColor("#4b5563").text(
          "As you are local to us we offer free delivery to your postcode on a Tuesday and a Friday. We will let you know on the morning of your delivery and you can expect to see Tim with your order before lunchtime!",
          margin, y, { width: 280 }
        );
      }
    }

    if (order.deliveryAddress && !isCollection) {
      y += (shipLabel ? 14 : 10);
      doc.fillColor("#555555").fontSize(7.5).font("Helvetica-Bold").text("Delivery Address:", margin, y);
      y += 10;
      doc.font("Helvetica").fontSize(7.5).fillColor("#374151").text(order.deliveryAddress, margin, y, { width: 220 });
    }

    // ── Footer (within printable area) ────────────────────────────────────────
    const footY = pageH - margin - 16;
    doc.fontSize(6.5).fillColor("#9ca3af").font("Helvetica")
      .text(
        `Select Branding Solutions Ltd  ·  Spence Mills, Mill Lane, Leeds LS13 3HE  ·  ${SBS_PHONE_DISPLAY}  ·  info@selectbranding.co.uk  ·  www.selectbranding.co.uk`,
        margin, footY, { align: "center", width: contentW, lineBreak: false }
      );

    doc.end();
  });
}

// ─── Purchase Order PDF + Email ───────────────────────────────────────────────

interface POItemData {
  supplierCode: string | null;
  productSku: string | null;
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
  supplierContactName?: string | null;
  supplierPhone?: string | null;
  supplierAddress?: string | null;
  createdAt: Date | string;
  notes: string | null;
  items: POItemData[];
}

/** Build a matrix: groups by (supplierCode|productName), rows = colours, cols = sizes */
function buildMatrix(items: POItemData[]) {
  const groupKeys: string[] = [];
  const groups = new Map<string, { code: string | null; sbsCode: string | null; productName: string; price: number | null; colours: string[]; sizes: string[]; qty: Map<string, Map<string, number>> }>();

  for (const item of items) {
    const gk = item.supplierCode ?? item.productName;
    if (!groups.has(gk)) {
      groupKeys.push(gk);
      groups.set(gk, { code: item.supplierCode, sbsCode: item.productSku ?? null, productName: item.productName, price: item.supplierPrice, colours: [], sizes: [], qty: new Map() });
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

    const MARGIN = 50;
    const W = doc.page.width - MARGIN * 2;
    const PAGE_H = doc.page.height;
    const dateStr = new Date(po.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    const logoBuffer = SBS_LOGO_BUFFER ?? Buffer.from(SBS_LOGO_DATA_URL.split(",")[1], "base64");

    // ── Header ────────────────────────────────────────────────────────────────
    const headerH = 88;
    doc.rect(MARGIN, MARGIN, W, headerH).fill("#1e293b");
    doc.image(logoBuffer, 65, 63, { fit: [155, 55], align: "left", valign: "center" });
    const rightX = MARGIN + W - 190;
    doc.fillColor("#94a3b8").fontSize(9).font("Helvetica")
      .text("Purchase Order", rightX, 65, { width: 185, align: "right" });
    doc.fillColor("#ffffff").fontSize(13).font("Helvetica-Bold")
      .text(po.poNumber, rightX, 79, { width: 185, align: "right" });
    doc.fillColor("#cbd5e1").fontSize(9).font("Helvetica")
      .text(dateStr, rightX, 96, { width: 185, align: "right" });

    // ── Supplier block (left) + Deliver To block (right) ─────────────────────
    let y = MARGIN + headerH + 16;
    const colW2 = (W - 16) / 2; // two equal columns with a gap
    const rightColX = MARGIN + colW2 + 16;

    const supRow = (label: string, value: string, col: "left" | "right" = "left") => {
      const x = col === "left" ? MARGIN : rightColX;
      const valueX = col === "left" ? MARGIN + 75 : rightColX + 75;
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#374151")
        .text(label, x, y, { width: 70, lineBreak: false });
      doc.font("Helvetica").fontSize(9).fillColor("#111827")
        .text(value, valueX, y, { width: colW2 - 80, lineBreak: false });
      y += 14;
    };

    // Left column: supplier details
    const leftStart = y;
    supRow("Supplier:", po.supplierName);
    if (po.supplierContactName) supRow("Attention:", po.supplierContactName);
    if (po.supplierAddress)     supRow("Address:",   po.supplierAddress);
    if (po.supplierPhone)       supRow("Phone:",     po.supplierPhone);
    if (po.supplierEmail)       supRow("Email:",     po.supplierEmail);
    if (po.notes)               supRow("Notes:",     po.notes);
    const afterLeft = y;

    // Right column: deliver to (SBS address)
    y = leftStart;
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#374151")
      .text("Deliver To:", rightColX, y, { width: colW2, lineBreak: false });
    y += 14;
    const deliverLines = [
      "Select Branding Solutions",
      "Spence Mills, Mill Lane",
      "Leeds, LS13 3HE",
      "info@selectbranding.co.uk",
    ];
    for (const line of deliverLines) {
      doc.font("Helvetica").fontSize(9).fillColor("#111827")
        .text(line, rightColX + 75, y, { width: colW2 - 80, lineBreak: false });
      y += 14;
    }

    y = Math.max(afterLeft, y) + 10;
    doc.moveTo(MARGIN, y).lineTo(MARGIN + W, y).strokeColor("#e2e8f0").lineWidth(0.5).stroke();
    y += 14;

    // ── Instruction notice ────────────────────────────────────────────────────
    const noticeText = "Please process and despatch at your earliest convenience. Should any items be out of stock please advise your estimated due date prior to despatch.";
    const noticeH = 22;
    doc.rect(MARGIN, y, W, noticeH).fill("#fefce8").stroke("#fde68a");
    doc.fillColor("#92400e").fontSize(8.5).font("Helvetica-Bold")
      .text(noticeText, MARGIN + 10, y + 7, { width: W - 20, align: "center", lineBreak: false });
    y += noticeH + 12;

    // ── Per-product style sections ────────────────────────────────────────────
    const { groupKeys, groups } = buildMatrix(po.items);
    const ROW_H = 20;
    const PROD_HDR_H = 24;
    const COL_HDR_H = 18;
    let grandTotal = 0;
    let grandValue = 0;

    for (const gk of groupKeys) {
      const g = groups.get(gk)!;
      const productSizes = g.sizes;
      const numCols = productSizes.length;

      // Column layout: Colour | size… | Total
      const COLOUR_W = 115;
      const TOTAL_W  = 48;
      const SIZE_W   = Math.min(60, Math.max(36, Math.floor((W - COLOUR_W - TOTAL_W) / Math.max(numCols, 1))));
      const TABLE_W  = COLOUR_W + SIZE_W * numCols + TOTAL_W;
      const tX       = MARGIN;

      // Estimate space needed: product header + col header + rows + totals row
      const sectionH = PROD_HDR_H + COL_HDR_H + (g.colours.length + 1) * ROW_H + 14;
      if (y + sectionH > PAGE_H - 60) {
        doc.addPage();
        y = MARGIN;
      }

      // ── Product heading band ──
      const code        = g.code ?? g.sbsCode ?? null;
      const sbsCodeNote = g.sbsCode && g.code && g.sbsCode !== g.code ? `  (SBS: ${g.sbsCode})` : "";
      doc.rect(MARGIN, y, W, PROD_HDR_H).fill("#0f172a");
      // Code on the left in monospace amber
      if (code) {
        doc.fillColor("#fbbf24").fontSize(10).font("Helvetica-Bold")
          .text(code, MARGIN + 8, y + 7, { width: 120, lineBreak: false });
        doc.fillColor("#f1f5f9").fontSize(10).font("Helvetica-Bold")
          .text(`  ${g.productName}${sbsCodeNote}`, MARGIN + 10 + 120, y + 7, { width: W - 148, lineBreak: false });
      } else {
        doc.fillColor("#f1f5f9").fontSize(10).font("Helvetica-Bold")
          .text(g.productName, MARGIN + 8, y + 7, { width: W - 16, lineBreak: false });
      }
      y += PROD_HDR_H;

      // ── Column header row ──
      doc.rect(tX, y, TABLE_W, COL_HDR_H).fill("#334155");
      doc.fillColor("#e2e8f0").fontSize(8).font("Helvetica-Bold");
      doc.text("Colour / Style", tX + 6, y + 5, { width: COLOUR_W - 6, lineBreak: false });
      let sx = tX + COLOUR_W;
      for (const sz of productSizes) {
        doc.text(sz, sx, y + 5, { width: SIZE_W, align: "center", lineBreak: false });
        sx += SIZE_W;
      }
      doc.text("Total", sx, y + 5, { width: TOTAL_W, align: "center", lineBreak: false });
      y += COL_HDR_H;

      // ── Colour rows ──
      let rowAlt = false;
      const sizeTotals = new Map<string, number>();
      let groupTotal = 0;

      for (const colour of g.colours) {
        if (y + ROW_H > PAGE_H - 60) { doc.addPage(); y = MARGIN; }
        const rowTotal = productSizes.reduce((s, sz) => s + (g.qty.get(colour)?.get(sz) ?? 0), 0);
        groupTotal += rowTotal;

        doc.rect(tX, y, TABLE_W, ROW_H)
          .fill(rowAlt ? "#f1f5f9" : "#ffffff")
          .stroke("#e2e8f0");

        // Colour label
        doc.fillColor("#111827").fontSize(9).font("Helvetica")
          .text(colour, tX + 6, y + 6, { width: COLOUR_W - 6, lineBreak: false });

        // Size quantities
        sx = tX + COLOUR_W;
        for (const sz of productSizes) {
          const qty = g.qty.get(colour)?.get(sz) ?? 0;
          if (qty > 0) sizeTotals.set(sz, (sizeTotals.get(sz) ?? 0) + qty);
          if (qty > 0) {
            doc.fillColor("#111827").fontSize(9).font("Helvetica-Bold")
              .text(String(qty), sx, y + 6, { width: SIZE_W, align: "center", lineBreak: false });
          } else {
            doc.fillColor("#cbd5e1").fontSize(9).font("Helvetica")
              .text("—", sx, y + 6, { width: SIZE_W, align: "center", lineBreak: false });
          }
          sx += SIZE_W;
        }

        // Row total
        doc.fillColor("#1e293b").fontSize(9).font("Helvetica-Bold")
          .text(String(rowTotal), sx, y + 6, { width: TOTAL_W, align: "center", lineBreak: false });

        y += ROW_H;
        rowAlt = !rowAlt;
      }

      // ── Size-totals row ──
      if (y + ROW_H > PAGE_H - 60) { doc.addPage(); y = MARGIN; }
      doc.rect(tX, y, TABLE_W, ROW_H).fill("#dde3ea").stroke("#c8d0da");
      doc.fillColor("#1e293b").fontSize(8).font("Helvetica-Bold")
        .text("TOTAL", tX + 6, y + 6, { width: COLOUR_W - 6, lineBreak: false });
      sx = tX + COLOUR_W;
      for (const sz of productSizes) {
        const t = sizeTotals.get(sz) ?? 0;
        doc.fillColor("#1e293b").fontSize(9).font("Helvetica-Bold")
          .text(t > 0 ? String(t) : "—", sx, y + 6, { width: SIZE_W, align: "center", lineBreak: false });
        sx += SIZE_W;
      }
      doc.fillColor("#1e293b").fontSize(9).font("Helvetica-Bold")
        .text(String(groupTotal), sx, y + 6, { width: TOTAL_W, align: "center", lineBreak: false });
      y += ROW_H;

      grandTotal += groupTotal;
      if (g.price != null) grandValue += groupTotal * g.price;
      y += 16; // gap between product sections
    }

    // ── Grand total bar ───────────────────────────────────────────────────────
    if (y + 26 > PAGE_H - 50) { doc.addPage(); y = MARGIN; }
    doc.rect(MARGIN, y, W, 26).fill("#1e293b");
    const gtText = grandValue > 0
      ? `Total order: ${grandTotal} units  ·  Est. value: £${grandValue.toFixed(2)}`
      : `Total order: ${grandTotal} units`;
    doc.fillColor("#ffffff").fontSize(11).font("Helvetica-Bold")
      .text(gtText, MARGIN + 8, y + 8, { width: W - 16, align: "right", lineBreak: false });
    y += 38;

    // ── Footer ────────────────────────────────────────────────────────────────
    doc.fillColor("#9ca3af").fontSize(8).font("Helvetica")
      .text("Select Branding Solutions · Effortless uniform management from order to delivery.", MARGIN, PAGE_H - 38, { align: "center", width: W, lineBreak: false });

    doc.end();
  });
}

export function buildPOEmail(po: POData, extraNotes: string): { subject: string; html: string; text: string } {
  const { groupKeys, groups } = buildMatrix(po.items);
  const dateStr = new Date(po.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const subject = `Purchase Order ${po.poNumber} — Select Branding Solutions`;

  // Per-product section HTML
  const productSectionsHtml = groupKeys.map((gk) => {
    const g = groups.get(gk)!;
    const code = g.code ?? g.sbsCode ?? null;
    const productSizes = g.sizes;
    const sizeHeaders = productSizes.map((s) =>
      `<th style="padding:7px 8px;text-align:center;font-size:11px;font-weight:700;color:#e2e8f0;background:#334155;border-left:1px solid #475569;">${s}</th>`
    ).join("");

    let groupTotal = 0;
    const sizeTotals = new Map<string, number>();

    const dataRows = g.colours.map((colour, ci) => {
      const rowTotal = productSizes.reduce((s, sz) => s + (g.qty.get(colour)?.get(sz) ?? 0), 0);
      groupTotal += rowTotal;
      const bg = ci % 2 === 0 ? "#ffffff" : "#f8fafc";
      const sizeCells = productSizes.map((sz) => {
        const qty = g.qty.get(colour)?.get(sz) ?? 0;
        if (qty > 0) sizeTotals.set(sz, (sizeTotals.get(sz) ?? 0) + qty);
        return `<td style="padding:7px 8px;text-align:center;border-left:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;font-size:13px;${qty > 0 ? "font-weight:700;color:#111827;" : "color:#d1d5db;"}">${qty > 0 ? qty : "—"}</td>`;
      }).join("");
      return `<tr style="background:${bg};">
        <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#111827;">${colour}</td>
        ${sizeCells}
        <td style="padding:7px 8px;text-align:center;border-left:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;font-size:13px;font-weight:700;color:#1e293b;">${rowTotal}</td>
      </tr>`;
    }).join("");

    const totalCells = productSizes.map((sz) => {
      const t = sizeTotals.get(sz) ?? 0;
      return `<td style="padding:7px 8px;text-align:center;border-left:1px solid #c8d0da;font-size:13px;font-weight:700;color:#1e293b;background:#dde3ea;">${t > 0 ? t : "—"}</td>`;
    }).join("");

    const headingBg = "#0f172a";
    const codeHtml = code
      ? `<span style="font-family:monospace;color:#fbbf24;font-size:12px;font-weight:700;">${code}</span>&nbsp;&nbsp;`
      : "";

    return `
      <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:6px;overflow:hidden;margin-bottom:18px;border:1px solid #e2e8f0;">
        <tr>
          <td colspan="${1 + productSizes.length + 1}" style="background:${headingBg};padding:9px 12px;">
            ${codeHtml}<span style="color:#f1f5f9;font-size:13px;font-weight:700;">${g.productName}</span>
          </td>
        </tr>
        <tr style="background:#334155;">
          <th style="padding:7px 10px;text-align:left;font-size:11px;font-weight:700;color:#e2e8f0;">Colour / Style</th>
          ${sizeHeaders}
          <th style="padding:7px 8px;text-align:center;font-size:11px;font-weight:700;color:#e2e8f0;border-left:1px solid #475569;">Total</th>
        </tr>
        ${dataRows}
        <tr style="background:#dde3ea;">
          <td style="padding:7px 10px;font-size:12px;font-weight:700;color:#1e293b;">TOTAL</td>
          ${totalCells}
          <td style="padding:7px 8px;text-align:center;border-left:1px solid #c8d0da;font-size:13px;font-weight:700;color:#1e293b;">${groupTotal}</td>
        </tr>
      </table>`;
  }).join("");

  const totalUnits = po.items.reduce((s, i) => s + i.quantityOrdered, 0);
  const totalValue = po.items.reduce((s, i) => s + (i.supplierPrice != null ? i.supplierPrice * i.quantityOrdered : 0), 0);

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="640" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
        <tr><td style="background:#1e293b;padding:20px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:middle;">
              <img src="${SBS_LOGO_DATA_URL}" alt="Select Branding Solutions" height="48" style="display:block;height:48px;width:auto;" />
            </td>
            <td style="vertical-align:middle;text-align:right;">
              <p style="margin:0;color:#94a3b8;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Purchase Order</p>
              <p style="margin:3px 0 0;color:#fff;font-size:15px;font-weight:700;">${po.poNumber}</p>
              <p style="margin:2px 0 0;color:#cbd5e1;font-size:11px;">${dateStr}</p>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:28px 32px;">
          <p style="margin:0 0 24px;font-size:14px;color:#374151;line-height:1.6;">Dear ${po.supplierContactName ?? po.supplierName},<br><br>Please supply the following items for purchase order <strong>${po.poNumber}</strong> dated ${dateStr}. The PDF attached contains the same information for your records.</p>
          ${productSectionsHtml}
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px;margin-bottom:24px;">
            <tr style="background:#1e293b;">
              <td style="padding:10px 16px;color:#94a3b8;font-size:12px;font-weight:600;text-transform:uppercase;">Total order</td>
              <td style="padding:10px 16px;color:#ffffff;font-size:15px;font-weight:700;text-align:right;">${totalUnits} units${totalValue > 0 ? `  ·  £${totalValue.toFixed(2)}` : ""}</td>
            </tr>
          </table>
          ${po.notes || extraNotes ? `<p style="font-size:14px;color:#374151;margin-bottom:20px;padding:10px 14px;background:#fffbeb;border-left:3px solid #f59e0b;border-radius:0 4px 4px 0;"><strong>Notes:</strong> ${[po.notes, extraNotes].filter(Boolean).join(" — ")}</p>` : ""}
          <p style="font-size:14px;color:#374151;margin:0;line-height:1.6;">Please confirm receipt of this order at your earliest convenience.<br><br>Kind regards,<br><strong>Select Branding Solutions</strong></p>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:14px 32px;border-top:1px solid #e5e7eb;">
          <p style="margin:0;font-size:11px;color:#9ca3af;text-align:center;">Select Branding Solutions · Effortless uniform management from order to delivery.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  // Plain-text fallback
  const lines = [`Dear ${po.supplierName},`, ``, `Please supply the following items for PO ${po.poNumber} (${dateStr}):`, ``];
  for (const gk of groupKeys) {
    const g = groups.get(gk)!;
    const code = g.code ?? g.sbsCode;
    lines.push(`${code ? `[${code}] ` : ""}${g.productName}`);
    lines.push("-".repeat(40));
    // Header
    const hdr = ["Colour".padEnd(20), ...g.sizes.map((s) => s.padStart(6)), "Total".padStart(7)].join("  ");
    lines.push(hdr);
    for (const colour of g.colours) {
      const rowTotal = g.sizes.reduce((s, sz) => s + (g.qty.get(colour)?.get(sz) ?? 0), 0);
      const cells = g.sizes.map((sz) => { const q = g.qty.get(colour)?.get(sz) ?? 0; return (q > 0 ? String(q) : "—").padStart(6); });
      lines.push([colour.padEnd(20), ...cells, String(rowTotal).padStart(7)].join("  "));
    }
    lines.push(``);
  }
  lines.push(`Total: ${totalUnits} units`);
  if (po.notes || extraNotes) lines.push(``, `Notes: ${[po.notes, extraNotes].filter(Boolean).join(" — ")}`);
  lines.push(``, `Kind regards,`, `Select Branding Solutions`);

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
  let customerFirstName: string | null = null;
  if (order.customerId) {
    const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, order.customerId));
    customerEmail = (customer as any)?.email ?? null;
    customerFirstName = (customer as any)?.contactFirstName ?? null;
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
      `Hi ${toFirstName(customerFirstName)},`,
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
          <p>Hi ${toFirstName(customerFirstName)},</p>
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
