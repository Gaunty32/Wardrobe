import { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Loader2, CheckCircle2 } from 'lucide-react';

const WHATSAPP_NUMBER = '441132552694';
const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}`;

interface FormState {
  name: string;
  email: string;
  message: string;
}

type Status = 'idle' | 'loading' | 'success' | 'error';
type View = 'choice' | 'chat';

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('choice');
  const [form, setForm] = useState<FormState>({ name: '', email: '', message: '' });
  const [status, setStatus] = useState<Status>('idle');
  const [refNum, setRefNum] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open && view === 'chat' && status === 'idle') {
      setTimeout(() => messageRef.current?.focus(), 120);
    }
  }, [open, view, status]);

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

  const handleClose = () => {
    setOpen(false);
  };

  const handleOpen = () => {
    setView('choice');
    reset();
    setOpen(true);
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {/* Panel */}
      {open && (
        <div
          ref={panelRef}
          className="w-80 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden flex flex-col"
          style={{ maxHeight: '520px' }}
        >
          {/* Header */}
          <div className="bg-primary px-4 py-3.5 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                <MessageCircle className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-sm font-bold text-white leading-none">Get in touch</p>
                <p className="text-xs text-white/70 mt-0.5 leading-none">We're here to help</p>
              </div>
            </div>
            <button onClick={handleClose} className="text-white/70 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto">
            {view === 'choice' ? (
              <div className="p-5 space-y-3">
                <p className="text-sm text-gray-500 mb-4">
                  How would you like to reach us?
                </p>

                {/* WhatsApp option */}
                <a
                  href={WHATSAPP_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex items-center gap-3.5 w-full rounded-xl border-2 border-[#25D366]/30 bg-[#25D366]/5 hover:bg-[#25D366]/10 hover:border-[#25D366]/60 transition-all px-4 py-3.5 text-left group"
                >
                  {/* WhatsApp icon */}
                  <div className="w-10 h-10 rounded-full bg-[#25D366] flex items-center justify-center shrink-0 shadow-sm">
                    <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm leading-snug">WhatsApp</p>
                    <p className="text-xs text-gray-500 mt-0.5">Message us directly — fast replies</p>
                  </div>
                  <svg className="w-4 h-4 text-gray-400 group-hover:text-[#25D366] transition-colors shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </a>

                {/* Chat / enquiry form option */}
                <button
                  onClick={() => { reset(); setView('chat'); }}
                  className="flex items-center gap-3.5 w-full rounded-xl border-2 border-primary/20 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-all px-4 py-3.5 text-left group"
                >
                  <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center shrink-0 shadow-sm">
                    <MessageCircle className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm leading-snug">Send a message</p>
                    <p className="text-xs text-gray-500 mt-0.5">We'll reply by email within a few hours</p>
                  </div>
                  <svg className="w-4 h-4 text-gray-400 group-hover:text-primary transition-colors shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            ) : (
              <div className="p-4">
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
                    <button onClick={() => setView('choice')} className="text-sm text-primary font-medium hover:underline">
                      ← Back
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-3">
                    <button
                      type="button"
                      onClick={() => { reset(); setView('choice'); }}
                      className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors mb-1"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                      </svg>
                      Back
                    </button>

                    <p className="text-sm text-gray-500">
                      Send us a message and we'll get back to you soon.
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
            )}
          </div>
        </div>
      )}

      {/* Bubble toggle */}
      <button
        onClick={() => open ? handleClose() : handleOpen()}
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
