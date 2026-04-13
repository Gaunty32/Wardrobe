import nodemailer from "nodemailer";

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
