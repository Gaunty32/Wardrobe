import { useState } from "react";
import { Mail, FileText, Send, Loader2, CheckCircle, TriangleAlert, CalendarDays, PackageCheck, Upload } from "lucide-react";

const items = [
  { id: 1, code: "PS0010", name: "Tricolore Left Sleeve", hasFile: true },
  { id: 2, code: "PS0009", name: "Sponsors Right Sleeve", hasFile: true },
  { id: 3, code: "PS0008", name: "Sponsors Left Sleeve", hasFile: false },
  { id: 4, code: "PS0012", name: "Fast Lane Club Left Chest Print", hasFile: true },
  { id: 5, code: "PS0007", name: "Chubb Right Chest Logo", hasFile: false },
  { id: 6, code: "PS0006", name: "Chubb & Fast Lane Rear Print", hasFile: true },
];

export default function NoEmail() {
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [dueDate, setDueDate] = useState("");

  const canSend = email.trim().includes("@");
  const missingCount = items.filter((i) => !i.hasFile).length;

  return (
    <div className="min-h-screen bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md flex flex-col" style={{ maxHeight: "90vh" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-blue-500" />
            <span className="font-semibold text-gray-900">Send PO — PO-2026-05-9082</span>
          </div>
          <button className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Manual email input */}
          <div className="space-y-1.5">
            <label className="text-xs text-gray-400 flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5" /> Recipient email
            </label>
            <input
              type="email"
              placeholder="supplier@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <p className="text-xs text-amber-700">No email on file — enter one above or use "Mark as Ordered" instead.</p>
          </div>

          {/* Print files */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Print files to attach</span>
              <span className="text-xs text-gray-400">4/6 ready</span>
            </div>
            <div className="rounded-lg border border-gray-200 divide-y text-sm overflow-y-auto" style={{ maxHeight: "160px" }}>
              {items.map((i) => (
                <div
                  key={i.id}
                  className={`flex items-center gap-2 px-3 py-2 ${!i.hasFile ? "cursor-pointer hover:bg-amber-50 group" : ""}`}
                >
                  {i.hasFile ? (
                    <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
                  ) : (
                    <TriangleAlert className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  )}
                  <span className="font-mono text-xs font-semibold text-indigo-600 shrink-0">{i.code}</span>
                  <span className="truncate text-gray-700 flex-1">{i.name}</span>
                  {!i.hasFile && (
                    <span className="ml-auto flex items-center gap-1 text-xs text-amber-600 whitespace-nowrap group-hover:text-blue-500 transition-colors">
                      <Upload className="w-3 h-3" /> Upload
                    </span>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-amber-700">{missingCount} items without a print file — click a row above to upload.</p>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="text-xs text-gray-400">Additional notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any extra instructions for this supplier..."
              rows={2}
              className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          {/* Estimated delivery date */}
          <div className="space-y-1.5">
            <label className="text-xs text-gray-400 flex items-center gap-1.5">
              <CalendarDays className="w-3.5 h-3.5" /> Estimated delivery date (optional)
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center gap-2 flex-wrap">
          <button className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 mr-auto">
            <FileText className="w-4 h-4" /> Preview PDF
          </button>
          <button className="px-3 py-2 rounded-md border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button className="flex items-center gap-1.5 px-3 py-2 rounded-md border text-sm font-medium"
            style={{ borderColor: "#fcd34d", color: "#92400e", background: "#fffbeb" }}>
            <PackageCheck className="w-4 h-4" /> Mark as Ordered
          </button>
          <button
            disabled={!canSend}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-white transition-opacity"
            style={{ background: "#3b82f6", opacity: canSend ? 1 : 0.4 }}
          >
            <Send className="w-4 h-4" /> Send Email
          </button>
        </div>
      </div>
    </div>
  );
}
