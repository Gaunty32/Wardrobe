/**
 * DPD UK API v2 integration
 * Docs: https://api2.dpd.co.uk/
 *
 * Required env vars:
 *   DPD_USERNAME        – DPD account username (email)
 *   DPD_PASSWORD        – DPD account password
 *   DPD_ACCOUNT_NUMBER  – DPD account / Fin number
 *
 * Optional env vars (default to empty — DPD uses account defaults):
 *   DPD_SENDER_NAME     – Business name shown on labels
 *   DPD_SENDER_LINE1    – Collection address street
 *   DPD_SENDER_TOWN     – Collection town / city
 *   DPD_SENDER_POSTCODE – Collection postcode
 *   DPD_NETWORK_CODE    – Service code, e.g. "1^12" (next-day by 12) or "1" (next-day)
 */

const DPD_BASE = "https://api.dpd.co.uk";

function getConfig() {
  const required = [
    "DPD_USERNAME",
    "DPD_PASSWORD",
    "DPD_ACCOUNT_NUMBER",
  ] as const;

  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`DPD not configured. Missing env vars: ${missing.join(", ")}`);
  }

  return {
    username: process.env.DPD_USERNAME!,
    password: process.env.DPD_PASSWORD!,
    accountNumber: process.env.DPD_ACCOUNT_NUMBER!,
    senderName: process.env.DPD_SENDER_NAME ?? "",
    senderLine1: process.env.DPD_SENDER_LINE1 ?? "",
    senderTown: process.env.DPD_SENDER_TOWN ?? "",
    senderPostcode: process.env.DPD_SENDER_POSTCODE ?? "",
    networkCode: process.env.DPD_NETWORK_CODE ?? "1^12",
  };
}

async function login(cfg: ReturnType<typeof getConfig>): Promise<string> {
  const credentials = Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64");
  const res = await fetch(`${DPD_BASE}/user/?action=login`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json;charset=UTF-8",
      GeoClient: `account/${cfg.accountNumber}`,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DPD login failed (${res.status}): ${body}`);
  }

  const json = await res.json() as { data?: { GeoSession?: string } };
  const session = json?.data?.GeoSession;
  if (!session) {
    throw new Error(`DPD login succeeded but returned no GeoSession. Response: ${JSON.stringify(json)}`);
  }
  return session;
}

export interface DpdDeliveryAddress {
  contactName: string;
  organisation?: string;
  line1: string;
  line2?: string;
  town: string;
  postcode: string;
  countryCode?: string;
  telephone?: string;
}

export interface BookConsignmentParams {
  orderNumber: string;
  delivery: DpdDeliveryAddress;
  numberOfParcels: number;
  totalWeightKg: number;
  collectionDate?: Date;
}

export interface ConsignmentResult {
  consignmentNumber: string;
  jobId: number;
  trackingUrl: string;
  labelPdfBase64: string | null;
}

export async function bookDpdConsignment(params: BookConsignmentParams): Promise<ConsignmentResult> {
  const cfg = getConfig();
  const geoSession = await login(cfg);

  const authHeaders = {
    "Content-Type": "application/json;charset=UTF-8",
    GeoClient: `account/${cfg.accountNumber}`,
    GeoSession: geoSession,
  };

  const collectionDate = (params.collectionDate ?? new Date()).toISOString().split("T")[0] + "T00:00:00";

  const shipmentPayload = {
    jobId: null,
    collectionOnDelivery: false,
    invoice: null,
    collectionDate,
    consolidate: false,
    consignment: [
      {
        consignmentNumber: null,
        consignmentRef: params.orderNumber,
        parcels: [],
        collectionDetails: {
          contactDetails: {
            contactName: cfg.senderName,
            telephone: "",
          },
          address: {
            organisation: cfg.senderName,
            countryCode: "GB",
            postcode: cfg.senderPostcode,
            street: cfg.senderLine1,
            locality: "",
            town: cfg.senderTown,
            county: "",
          },
        },
        deliveryDetails: {
          contactDetails: {
            contactName: params.delivery.contactName,
            telephone: params.delivery.telephone ?? "",
          },
          address: {
            organisation: params.delivery.organisation ?? params.delivery.contactName,
            countryCode: params.delivery.countryCode ?? "GB",
            postcode: params.delivery.postcode,
            street: params.delivery.line1,
            locality: params.delivery.line2 ?? "",
            town: params.delivery.town,
            county: "",
          },
        },
        networkCode: cfg.networkCode,
        numberOfParcels: params.numberOfParcels,
        totalWeight: params.totalWeightKg,
        shippingRef1: params.orderNumber,
        shippingRef2: "",
        shippingRef3: "",
      },
    ],
  };

  const shipRes = await fetch(`${DPD_BASE}/shipment/`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(shipmentPayload),
  });

  if (!shipRes.ok) {
    const body = await shipRes.text();
    throw new Error(`DPD shipment booking failed (${shipRes.status}): ${body}`);
  }

  const shipJson = await shipRes.json() as {
    data?: {
      shipment?: Array<{ consignmentNumber?: string }>;
      jobId?: number;
    };
    error?: { errorCode?: number; errorMessage?: string };
  };

  if (shipJson.error?.errorCode && shipJson.error.errorCode !== 0) {
    throw new Error(`DPD error ${shipJson.error.errorCode}: ${shipJson.error.errorMessage}`);
  }

  const consignmentNumber = shipJson.data?.shipment?.[0]?.consignmentNumber ?? "";
  const jobId = shipJson.data?.jobId ?? 0;

  // Try to fetch the label PDF (non-fatal if it fails)
  let labelPdfBase64: string | null = null;
  try {
    const labelRes = await fetch(
      `${DPD_BASE}/label/${cfg.accountNumber}/${jobId}?format=PDF`,
      { headers: authHeaders }
    );
    if (labelRes.ok) {
      const buf = await labelRes.arrayBuffer();
      labelPdfBase64 = Buffer.from(buf).toString("base64");
    }
  } catch {
    // Label fetch is best-effort; dispatch still succeeds
  }

  return {
    consignmentNumber,
    jobId,
    trackingUrl: `https://track.dpd.co.uk/search?reference=${consignmentNumber}`,
    labelPdfBase64,
  };
}

export async function reprrintDpdLabel(jobId: number): Promise<string | null> {
  try {
    const cfg = getConfig();
    const geoSession = await login(cfg);
    const headers = {
      GeoClient: `account/${cfg.accountNumber}`,
      GeoSession: geoSession,
    };
    const res = await fetch(`${DPD_BASE}/label/${cfg.accountNumber}/${jobId}?format=PDF`, { headers });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return Buffer.from(buf).toString("base64");
  } catch {
    return null;
  }
}

export function isDpdConfigured(): boolean {
  return ["DPD_USERNAME", "DPD_PASSWORD", "DPD_ACCOUNT_NUMBER"].every((k) => !!process.env[k]);
}

export async function testDpdConnection(): Promise<{ ok: boolean; message: string; accountNumber?: string }> {
  try {
    const cfg = getConfig();
    const geoSession = await login(cfg);
    if (!geoSession) throw new Error("Login succeeded but no GeoSession returned");
    return {
      ok: true,
      message: `Connected successfully. GeoSession token received.`,
      accountNumber: cfg.accountNumber,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
