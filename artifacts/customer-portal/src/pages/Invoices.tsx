import { useQuery } from "@tanstack/react-query";
import PortalLayout from "@/components/Layout";
import { apiFetch, API_BASE } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, FileText, Download, Receipt, CheckCircle2, Clock, AlertCircle } from "lucide-react";

interface Invoice {
  id: number;
  order_number: string | null;
  invoice_email_sent_at: string;
  total_amount: string | null;
  xero_invoice_id: string | null;
  xero_invoice_status: string | null;
  tracking_number: string | null;
  order_date: string | null;
  customer_name: string | null;
  status: string | null;
}

function XeroStatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const s = status.toUpperCase();
  if (s === "PAID")
    return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200"><CheckCircle2 className="w-3 h-3 mr-1" />Paid</Badge>;
  if (s === "AUTHORISED")
    return <Badge className="bg-blue-100 text-blue-700 border-blue-200"><Clock className="w-3 h-3 mr-1" />Awaiting Payment</Badge>;
  if (s === "VOIDED" || s === "DELETED")
    return <Badge variant="outline" className="text-muted-foreground">Voided</Badge>;
  return <Badge variant="outline" className="text-muted-foreground capitalize">{status.toLowerCase()}</Badge>;
}

export default function Invoices() {
  const { data: invoices, isLoading } = useQuery<Invoice[]>({
    queryKey: ["portal-invoices"],
    queryFn: () => apiFetch("/portal/invoices"),
  });

  const downloadPdf = (invoice: Invoice) => {
    const url = `${API_BASE}/portal/invoices/${invoice.id}/pdf`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `Invoice-${invoice.order_number ?? invoice.id}.pdf`;
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <PortalLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Invoices</h1>
          <p className="text-sm text-muted-foreground mt-1">Download your invoices and check payment status.</p>
        </div>

        {isLoading && (
          <div className="flex justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && (!invoices || invoices.length === 0) && (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <Receipt className="w-10 h-10 text-muted-foreground/30" />
              <p className="font-medium text-muted-foreground">No invoices yet</p>
              <p className="text-sm text-muted-foreground/70 max-w-xs">
                Your invoices will appear here once orders have been completed and invoiced.
              </p>
            </CardContent>
          </Card>
        )}

        {invoices && invoices.length > 0 && (
          <>
            {/* Summary bar */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Card>
                <CardContent className="py-4 px-5">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Total Invoices</p>
                  <p className="text-2xl font-bold mt-1">{invoices.length}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="py-4 px-5">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Paid</p>
                  <p className="text-2xl font-bold mt-1 text-emerald-600">
                    {invoices.filter(i => i.xero_invoice_status?.toUpperCase() === "PAID").length}
                  </p>
                </CardContent>
              </Card>
              <Card className="col-span-2 sm:col-span-1">
                <CardContent className="py-4 px-5">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Awaiting Payment</p>
                  <p className="text-2xl font-bold mt-1 text-blue-600">
                    {invoices.filter(i => i.xero_invoice_status?.toUpperCase() === "AUTHORISED").length}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Invoice list */}
            <div className="space-y-2">
              {invoices.map((invoice) => (
                <Card key={invoice.id} className="hover:shadow-sm transition-shadow">
                  <CardContent className="py-4 px-5">
                    <div className="flex items-center gap-4">
                      <div className="hidden sm:flex h-10 w-10 rounded-lg bg-primary/10 items-center justify-center shrink-0">
                        <FileText className="w-5 h-5 text-primary" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-foreground">
                            {invoice.order_number ?? `Order #${invoice.id}`}
                          </span>
                          <XeroStatusBadge status={invoice.xero_invoice_status} />
                          {!invoice.xero_invoice_status && (
                            <Badge variant="outline" className="text-muted-foreground text-xs">
                              <AlertCircle className="w-3 h-3 mr-1" />Invoiced
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground flex-wrap">
                          <span>Invoiced {formatDate(invoice.invoice_email_sent_at)}</span>
                          {invoice.order_date && (
                            <span className="hidden sm:inline">· Order date {formatDate(invoice.order_date)}</span>
                          )}
                          {invoice.total_amount && (
                            <span className="font-medium text-foreground">
                              {formatCurrency(parseFloat(invoice.total_amount))}
                            </span>
                          )}
                        </div>
                      </div>

                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 shrink-0"
                        onClick={() => downloadPdf(invoice)}
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Download PDF</span>
                        <span className="sm:hidden">PDF</span>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>
    </PortalLayout>
  );
}
