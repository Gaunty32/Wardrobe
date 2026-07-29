import { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Loader2, CheckCircle2 } from 'lucide-react';

const WHATSAPP_NUMBER = '441132552694';
const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}`;

interface FormState { name: string; email: string; message: string; }
type Status = 'idle' | 'loading' | 'success' | 'error';
type View = 'choice' | 'livechat' | 'chat';

interface ChatMessage { role: 'user' | 'assistant'; content: string; }

// ── Chevron icon ──────────────────────────────────────────────────────────────
function Chevron({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

// ── Back button ───────────────────────────────────────────────────────────────
function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors mb-1"
    >
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
      </svg>
      Back
    </button>
  );
}

// ── Live Chat view ─────────────────────────────────────────────────────────────
function LiveChatView({ onBack }: { onBack: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: "Hi! 👋 I'm here to help with any questions about our workwear, uniforms, or services. What can I help you with today?" },
  ]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 80);
  }, []);

  const send = async () => {
    const text = input.trim();
    if (!text || thinking) return;
    setInput('');

    const next: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setThinking(true);

    try {
      const res = await fetch('/api/shop/live-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json();
      const reply: string = data.reply ?? data.error ?? "Sorry, something went wrong. Please try again.";
      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: "Sorry, I couldn't connect right now. Please try WhatsApp or send us a message." }]);
    } finally {
      setThinking(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-3 pb-1 shrink-0">
        <BackButton onClick={onBack} />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3 min-h-0">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {m.role === 'assistant' && (
              <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mr-2 mt-0.5">
                <MessageCircle className="w-3.5 h-3.5 text-primary" />
              </div>
            )}
            <div
              className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                m.role === 'user'
                  ? 'bg-primary text-white rounded-br-sm'
                  : 'bg-gray-100 text-gray-800 rounded-bl-sm'
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}

        {thinking && (
          <div className="flex justify-start">
            <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mr-2 mt-0.5">
              <MessageCircle className="w-3.5 h-3.5 text-primary" />
            </div>
            <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1">
              {[0, 1, 2].map(i => (
                <span key={i} className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-3 border-t border-gray-100 shrink-0">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Type a message…"
            disabled={thinking}
            className="flex-1 border border-gray-200 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-50"
          />
          <button
            onClick={send}
            disabled={!input.trim() || thinking}
            className="w-9 h-9 rounded-full bg-primary text-white flex items-center justify-center shrink-0 hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        <p className="text-center text-[10px] text-gray-400 mt-1.5">AI assistant · complex queries → WhatsApp or message us</p>
      </div>
    </div>
  );
}

// ── Main widget ────────────────────────────────────────────────────────────────
export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('choice');
  const [form, setForm] = useState<FormState>({ name: '', email: '', message: '' });
  const [status, setStatus] = useState<Status>('idle');
  const [refNum, setRefNum] = useState('');
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
        body: JSON.stringify({ name: form.name, email: form.email, message: form.message, source: 'chat' }),
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setRefNum(data.referenceNumber ?? '');
      setStatus('success');
    } catch {
      setStatus('error');
    }
  };

  const reset = () => { setForm({ name: '', email: '', message: '' }); setStatus('idle'); setRefNum(''); };
  const handleClose = () => setOpen(false);
  const handleOpen = () => { setView('choice'); reset(); setOpen(true); };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {open && (
        <div
          className="w-80 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden flex flex-col"
          style={{ maxHeight: view === 'livechat' ? '480px' : '520px' }}
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
          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            {view === 'choice' && (
              <div className="p-5 space-y-3">
                <p className="text-sm text-gray-500 mb-4">How would you like to reach us?</p>

                {/* WhatsApp */}
                <a
                  href={WHATSAPP_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex items-center gap-3.5 w-full rounded-xl border-2 border-[#25D366]/30 bg-[#25D366]/5 hover:bg-[#25D366]/10 hover:border-[#25D366]/60 transition-all px-4 py-3.5 text-left group"
                >
                  <div className="w-10 h-10 rounded-full bg-[#25D366] flex items-center justify-center shrink-0 shadow-sm">
                    <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm leading-snug">WhatsApp</p>
                    <p className="text-xs text-gray-500 mt-0.5">Message us directly — fast replies</p>
                  </div>
                  <Chevron className="w-4 h-4 text-gray-400 group-hover:text-[#25D366] transition-colors shrink-0" />
                </a>

                {/* Live Chat */}
                <button
                  onClick={() => setView('livechat')}
                  className="flex items-center gap-3.5 w-full rounded-xl border-2 border-blue-200 bg-blue-50 hover:bg-blue-100 hover:border-blue-400 transition-all px-4 py-3.5 text-left group"
                >
                  <div className="relative w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center shrink-0 shadow-sm">
                    <MessageCircle className="w-5 h-5 text-white" />
                    <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-green-400 border-2 border-white rounded-full" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm leading-snug">Live Chat</p>
                    <p className="text-xs text-gray-500 mt-0.5">Instant answers — AI assistant</p>
                  </div>
                  <Chevron className="w-4 h-4 text-gray-400 group-hover:text-blue-500 transition-colors shrink-0" />
                </button>

                {/* Send a message */}
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
                  <Chevron className="w-4 h-4 text-gray-400 group-hover:text-primary transition-colors shrink-0" />
                </button>
              </div>
            )}

            {view === 'livechat' && (
              <LiveChatView onBack={() => setView('choice')} />
            )}

            {view === 'chat' && (
              <div className="p-4 overflow-y-auto flex-1">
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
                    <BackButton onClick={() => { reset(); setView('choice'); }} />

                    <p className="text-sm text-gray-500">
                      Send us a message and we'll get back to you soon.
                    </p>

                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Your name *</label>
                      <input name="name" value={form.name} onChange={handleChange} required placeholder="Jane Smith"
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Email address *</label>
                      <input name="email" type="email" value={form.email} onChange={handleChange} required placeholder="jane@company.com"
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Message *</label>
                      <textarea ref={messageRef} name="message" value={form.message} onChange={handleChange} required rows={3}
                        placeholder="How can we help?"
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none" />
                    </div>

                    {status === 'error' && (
                      <p className="text-xs text-red-600">Something went wrong — please try again.</p>
                    )}

                    <button type="submit" disabled={status === 'loading'}
                      className="w-full bg-primary text-white rounded-lg py-2.5 text-sm font-bold flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors disabled:opacity-60">
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
          : <><MessageCircle className="w-5 h-5" /><span className="text-sm font-bold">Chat with us</span></>
        }
      </button>
    </div>
  );
}
