import { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Loader2, CheckCircle2 } from 'lucide-react';

interface FormState {
  name: string;
  email: string;
  message: string;
}

type Status = 'idle' | 'loading' | 'success' | 'error';

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>({ name: '', email: '', message: '' });
  const [status, setStatus] = useState<Status>('idle');
  const [refNum, setRefNum] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  // Focus the message field when the panel opens
  useEffect(() => {
    if (open && status === 'idle') {
      setTimeout(() => messageRef.current?.focus(), 120);
    }
  }, [open, status]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.message.trim()) return;
    setStatus('loading');
    try {
      const res = await fetch('/api/shop/product-enquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          message: form.message,
          source: 'chat',
        }),
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setRefNum(data.referenceNumber ?? '');
      setStatus('success');
    } catch {
      setStatus('error');
    }
  };

  const reset = () => {
    setForm({ name: '', email: '', message: '' });
    setStatus('idle');
    setRefNum('');
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {/* Panel */}
      {open && (
        <div
          ref={panelRef}
          className="w-80 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden flex flex-col"
          style={{ maxHeight: '480px' }}
        >
          {/* Header */}
          <div className="bg-primary px-4 py-3.5 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                <MessageCircle className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-sm font-bold text-white leading-none">Chat with us</p>
                <p className="text-xs text-white/70 mt-0.5 leading-none">Typically replies within a few hours</p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-white/70 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4">
            {status === 'success' ? (
              <div className="text-center py-6 space-y-3">
                <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-6 h-6 text-green-600" />
                </div>
                <div>
                  <p className="font-semibold text-gray-900">Message sent!</p>
                  <p className="text-sm text-gray-500 mt-1">We'll get back to you shortly.</p>
                  {refNum && <p className="text-xs text-gray-400 mt-1">Ref: {refNum}</p>}
                </div>
                <button
                  onClick={reset}
                  className="text-sm text-primary font-medium hover:underline"
                >
                  Send another message
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3">
                <p className="text-sm text-gray-500">
                  Have a question? Send us a message and we'll get back to you soon.
                </p>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Your name *</label>
                  <input
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    required
                    placeholder="Jane Smith"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Email address *</label>
                  <input
                    name="email"
                    type="email"
                    value={form.email}
                    onChange={handleChange}
                    required
                    placeholder="jane@company.com"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Message *</label>
                  <textarea
                    ref={messageRef}
                    name="message"
                    value={form.message}
                    onChange={handleChange}
                    required
                    rows={3}
                    placeholder="How can we help?"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
                  />
                </div>

                {status === 'error' && (
                  <p className="text-xs text-red-600">Something went wrong — please try again.</p>
                )}

                <button
                  type="submit"
                  disabled={status === 'loading'}
                  className="w-full bg-primary text-white rounded-lg py-2.5 text-sm font-bold flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors disabled:opacity-60"
                >
                  {status === 'loading'
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
                    : <><Send className="w-4 h-4" /> Send message</>
                  }
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Bubble toggle */}
      <button
        onClick={() => { setOpen(o => !o); if (!open) reset(); }}
        className="flex items-center gap-2 bg-primary text-white rounded-full shadow-lg hover:bg-primary/90 active:scale-95 transition-all"
        style={{ padding: open ? '12px' : '12px 20px 12px 16px' }}
        aria-label="Chat with us"
      >
        {open
          ? <X className="w-5 h-5" />
          : <>
              <MessageCircle className="w-5 h-5" />
              <span className="text-sm font-bold">Chat with us</span>
            </>
        }
      </button>
    </div>
  );
}
