import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import PortalLayout from "@/components/Layout";
import { apiFetch } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Plus, Loader2, ShoppingBag, ArrowRight, Clock, CheckCircle2, XCircle, Package, AlertCircle,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

// ─── Smart welcome message ────────────────────────────────────────────────────

type WelcomeMessage = { greeting: string; body: string; emoji: string };

function getWelcomeMessage(firstName: string): WelcomeMessage {
  const now = new Date();
  const hour = now.getHours();
  const dow = now.getDay(); // 0=Sun, 6=Sat
  const month = now.getMonth() + 1; // 1-12
  const day = now.getDate();

  // Weekend
  if (dow === 0 || dow === 6) {
    const msgs = [
      { body: "Working on a weekend? We're pleased to see you — but don't forget, weekends are for enjoying yourself too! 😄", emoji: "☀️" },
      { body: "A weekend visit? Your dedication is impressive. Just make sure you switch off properly — the orders will still be here on Monday!", emoji: "🌿" },
      { body: "Great to see you're keeping on top of things, even on the weekend. You deserve a treat after this!", emoji: "🎉" },
    ];
    const pick = msgs[day % msgs.length];
    return { greeting: `Hi ${firstName}`, ...pick };
  }

  // Late night (after 8pm)
  if (hour >= 20) {
    const msgs = [
      { body: "Working late? Don't burn the candle at both ends — we'll still be here tomorrow morning, bright and early.", emoji: "🕯️" },
      { body: "Burning the midnight oil? That's commitment! Just don't forget to rest — your best ideas come when you're refreshed.", emoji: "🌙" },
      { body: "Late night session? Make sure you close the laptop soon. Tomorrow is a new day with new opportunities.", emoji: "⭐" },
    ];
    const pick = msgs[day % msgs.length];
    return { greeting: `Hi ${firstName}`, ...pick };
  }

  // Early morning (before 8am)
  if (hour < 8) {
    const msgs = [
      { body: "The early bird certainly catches the worm! You're ahead of the pack before most people have even had breakfast.", emoji: "🐦" },
      { body: "Morning! You're up bright and early. The office is all yours — the best ideas happen in the quiet hours!", emoji: "🌅" },
      { body: "Rise and shine! There's something special about the early morning — a head start on the whole day.", emoji: "☕" },
    ];
    const pick = msgs[day % msgs.length];
    return { greeting: `Morning ${firstName}`, ...pick };
  }

  // ── Weekday business hours: fun date fact ─────────────────────────────────

  // Notable specific dates (month/day)
  const notable: Record<string, { body: string; emoji: string }> = {
    "1/1":  { body: "Happy New Year! A fresh start, a blank page — make it a great one.", emoji: "🎆" },
    "1/25": { body: "It's Burns Night! Scotland celebrates Robert Burns tonight with haggis, neeps, tatties and a good dram.", emoji: "🏴󠁧󠁢󠁳󠁣󠁴󠁿" },
    "2/2":  { body: "It's Groundhog Day! The famous American tradition where a groundhog predicts the weather — though we'll trust the Met Office.", emoji: "🦡" },
    "2/14": { body: "Happy Valentine's Day! 💌 Did you know over a billion Valentine's Day cards are sent worldwide every year?", emoji: "❤️" },
    "3/1":  { body: "Happy St David's Day! A daffodil or leek for everyone from Wales today.", emoji: "🌼" },
    "3/14": { body: "It's Pi Day (3.14)! Mathematicians everywhere are celebrating the most famous number — 3.14159265...", emoji: "🥧" },
    "3/17": { body: "Happy St Patrick's Day! Over 13 million pints of Guinness are consumed globally today. Sláinte!", emoji: "🍀" },
    "4/1":  { body: "April Fools' Day! We promise there are no tricks in your order system today. Probably.", emoji: "🤡" },
    "4/22": { body: "It's Earth Day! Since 1970, over a billion people worldwide take part in events to protect our planet.", emoji: "🌍" },
    "4/23": { body: "Happy St George's Day! Also Shakespeare's birthday — he was born AND died on 23rd April, 1564 and 1616.", emoji: "🌹" },
    "5/4":  { body: "May the 4th be with you! Star Wars Day is celebrated by fans in over 130 countries.", emoji: "⭐" },
    "5/8":  { body: "It's VE Day — marking the end of World War II in Europe in 1945. A day to remember those who served.", emoji: "🕊️" },
    "6/21": { body: "Happy Summer Solstice! Today is the longest day of the year — enjoy that extra daylight!", emoji: "🌞" },
    "6/23": { body: "It's National Pink Day! Did you know pink was originally considered a masculine colour in the 18th century?", emoji: "🌸" },
    "7/4":  { body: "American Independence Day! The US Declaration of Independence was signed on this day in 1776.", emoji: "🦅" },
    "8/12": { body: "It's World Elephant Day! There are around 415,000 African elephants remaining in the wild — every one matters.", emoji: "🐘" },
    "9/5":  { body: "It's International Day of Charity! A great reminder that even small acts of kindness add up.", emoji: "💛" },
    "9/22": { body: "Happy Autumn Equinox! Day and night are roughly equal today — autumn is officially here.", emoji: "🍂" },
    "10/4": { body: "It's World Animal Day! Celebrating the welfare of animals around the globe.", emoji: "🐾" },
    "10/31": { body: "Happy Halloween! 👻 The tradition of carving pumpkins actually started with turnips in Ireland and Scotland.", emoji: "🎃" },
    "11/5": { body: "Remember, remember the 5th of November! Bonfire Night marks Guy Fawkes' failed Gunpowder Plot of 1605.", emoji: "🎇" },
    "11/11": { body: "Remembrance Day. At 11am on 11 November 1918, the guns fell silent on the Western Front. We remember.", emoji: "🌺" },
    "12/21": { body: "Winter Solstice — the shortest day of the year. From here, the days start getting longer again!", emoji: "❄️" },
    "12/24": { body: "Christmas Eve! Last-minute preparations are underway across the nation. Hope you've finished your shopping!", emoji: "🎄" },
    "12/25": { body: "Merry Christmas! 🎅 Did you know the average UK household receives 17 Christmas cards every year?", emoji: "🎁" },
    "12/31": { body: "New Year's Eve! Tonight, 7 billion people across 24 time zones will welcome in the new year.", emoji: "🥂" },
  };

  const key = `${month}/${day}`;
  if (notable[key]) {
    return { greeting: `Hi ${firstName}`, ...notable[key] };
  }

  // ── Seasonal pool (used as fallback, picked by day-of-year so it's consistent all day) ──
  const dayOfYear = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000);

  const seasonal: WelcomeMessage[] = [
    // General curiosities
    { greeting: `Hi ${firstName}`, emoji: "🐝", body: "Fun fact: Honey never spoils. Archaeologists have found 3,000-year-old honey in Egyptian tombs — and it was still perfectly edible!" },
    { greeting: `Hi ${firstName}`, emoji: "🌳", body: "Fun fact: There are more trees on Earth than stars in the Milky Way — an estimated 3 trillion trees versus 200–400 billion stars." },
    { greeting: `Hi ${firstName}`, emoji: "🦈", body: "Fun fact: Sharks are older than trees. Sharks have existed for around 450 million years, while trees only appeared about 360 million years ago." },
    { greeting: `Hi ${firstName}`, emoji: "🍕", body: "Fun fact: Pizza has been around since ancient times — the Romans ate a flatbread topped with olive oil and cheese over 2,000 years ago." },
    { greeting: `Hi ${firstName}`, emoji: "☕", body: "Fun fact: Coffee is the second most traded commodity in the world after oil. Over 2 billion cups are consumed every single day." },
    { greeting: `Hi ${firstName}`, emoji: "🌊", body: "Fun fact: The ocean produces 50–80% of all the oxygen on Earth — more than all the world's forests combined." },
    { greeting: `Hi ${firstName}`, emoji: "📚", body: "Fun fact: Oxford University is older than the Aztec Empire. Teaching began there in 1096; the Aztec Empire was founded in 1428." },
    { greeting: `Hi ${firstName}`, emoji: "🦋", body: "Fun fact: Butterflies taste with their feet. They have taste sensors on their legs to help them identify plants." },
    { greeting: `Hi ${firstName}`, emoji: "🎵", body: "Fun fact: 'Happy Birthday to You' is the most recognised song in the English language, sung an estimated 20 million times a day worldwide." },
    { greeting: `Hi ${firstName}`, emoji: "🌍", body: "Fun fact: Scotland's national animal is the unicorn. It was adopted as the royal symbol in the 12th century." },
    { greeting: `Hi ${firstName}`, emoji: "🧲", body: "Fun fact: A day on Venus is longer than a year on Venus. It takes 243 Earth days to rotate once, but only 225 to orbit the Sun." },
    { greeting: `Hi ${firstName}`, emoji: "🐙", body: "Fun fact: Octopuses have three hearts and blue blood. Two hearts pump blood to the gills; the third pumps it to the rest of the body." },
    { greeting: `Hi ${firstName}`, emoji: "🏰", body: "Fun fact: Windsor Castle is the oldest and largest occupied castle in the world, continuously inhabited for nearly 1,000 years." },
    { greeting: `Hi ${firstName}`, emoji: "🎨", body: "Fun fact: Leonardo da Vinci could write with one hand and draw with the other at the same time." },
    { greeting: `Hi ${firstName}`, emoji: "🌈", body: "Fun fact: No two people see a rainbow from exactly the same angle — every rainbow is unique to the observer." },
    { greeting: `Hi ${firstName}`, emoji: "🐘", body: "Fun fact: Elephants are the only animals that can't jump. They're also one of the few that can recognise themselves in a mirror." },
    { greeting: `Hi ${firstName}`, emoji: "🍫", body: "Fun fact: It takes 400 cocoa beans to make just 450g of chocolate. Each tree produces only about 2,500 beans per year." },
    { greeting: `Hi ${firstName}`, emoji: "🚀", body: "Fun fact: The footprints on the Moon will last for at least 100 million years — there's no wind or weather to erode them." },
    { greeting: `Hi ${firstName}`, emoji: "🦜", body: "Fun fact: The shortest war in history lasted just 38–45 minutes — the Anglo-Zanzibar War of 1896." },
    { greeting: `Hi ${firstName}`, emoji: "🌿", body: "Fun fact: Bamboo is the fastest-growing plant on Earth — it can grow up to 91cm in a single day under the right conditions." },
    { greeting: `Hi ${firstName}`, emoji: "🏆", body: "Fun fact: The Great Wall of China is not visible from space with the naked eye — that's a myth! It's only about 5–8 metres wide." },
    { greeting: `Hi ${firstName}`, emoji: "💡", body: "Fun fact: Thomas Edison didn't invent the lightbulb — he improved it. Multiple inventors worked on the idea before him." },
    { greeting: `Hi ${firstName}`, emoji: "🎭", body: "Fun fact: The word 'robot' comes from the Czech word 'robota', meaning forced labour. It first appeared in a 1921 play." },
    { greeting: `Hi ${firstName}`, emoji: "🌺", body: "Fun fact: There are more possible iterations of a game of chess than there are atoms in the known universe." },
    { greeting: `Hi ${firstName}`, emoji: "🧊", body: "Fun fact: Hot water can freeze faster than cold water under certain conditions — this is known as the Mpemba effect." },
    { greeting: `Hi ${firstName}`, emoji: "🦁", body: "Fun fact: A group of flamingos is called a 'flamboyance'. A group of owls is a 'parliament'. And a group of cats is a 'clowder'." },
    { greeting: `Hi ${firstName}`, emoji: "🌙", body: "Fun fact: The Moon is moving away from Earth at about 3.8cm per year — roughly the same rate as your fingernails grow." },
    { greeting: `Hi ${firstName}`, emoji: "🎲", body: "Fun fact: The odds of you existing are astronomically small — one estimate puts it at 1 in 400 trillion. Glad you're here!" },
  ];

  return seasonal[dayOfYear % seasonal.length];
}

function StatusBadge({ status, portalStatus }: { status: string; portalStatus?: string }) {
  if (portalStatus === "pending_review") {
    return <Badge variant="outline" className="border-orange-300 text-orange-700 bg-orange-50 gap-1"><AlertCircle className="w-3 h-3" />Awaiting approval</Badge>;
  }
  if (portalStatus === "pending" || status === "portal_pending") {
    return <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50 gap-1"><Clock className="w-3 h-3" />Pending SBS review</Badge>;
  }
  if (portalStatus === "submitted") {
    return <Badge variant="outline" className="border-blue-300 text-blue-700 bg-blue-50 gap-1"><Clock className="w-3 h-3" />Submitted to SBS</Badge>;
  }
  if (portalStatus === "confirmed" || status === "draft") {
    return <Badge variant="outline" className="border-blue-300 text-blue-700 bg-blue-50 gap-1"><CheckCircle2 className="w-3 h-3" />Confirmed</Badge>;
  }
  if (portalStatus === "rejected" || status === "cancelled") {
    return <Badge variant="outline" className="border-red-300 text-red-700 bg-red-50 gap-1"><XCircle className="w-3 h-3" />Rejected</Badge>;
  }
  if (status === "confirmed") return <Badge variant="outline" className="border-green-300 text-green-700 bg-green-50">In production</Badge>;
  if (status === "shipped") return <Badge className="bg-blue-100 text-blue-800 border-transparent">Shipped</Badge>;
  if (status === "delivered") return <Badge className="bg-green-100 text-green-800 border-transparent">Delivered</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

function ManagerReviewPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [rejectTarget, setRejectTarget] = useState<any | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const { data: pendingOrders = [], isLoading } = useQuery<any[]>({
    queryKey: ["portal-manager-pending"],
    queryFn: () => apiFetch("/portal/manager/pending-orders"),
  });

  const submitMutation = useMutation({
    mutationFn: (orderId: number) => apiFetch(`/portal/manager/orders/${orderId}/submit`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-manager-pending"] });
      queryClient.invalidateQueries({ queryKey: ["portal-orders"] });
      toast({ title: "Order submitted to SBS" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ orderId, reason }: { orderId: number; reason: string }) =>
      apiFetch(`/portal/manager/orders/${orderId}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-manager-pending"] });
      queryClient.invalidateQueries({ queryKey: ["portal-orders"] });
      setRejectTarget(null);
      setRejectReason("");
      toast({ title: "Order rejected" });
    },
  });

  if (isLoading) return null;
  if (pendingOrders.length === 0) return null;

  return (
    <>
      <Card className="mb-6 border-orange-200 bg-orange-50/40">
        <CardHeader className="pb-3 pt-4 px-5">
          <CardTitle className="text-base flex items-center gap-2 text-orange-800">
            <AlertCircle className="w-4 h-4" />
            Orders awaiting your approval
            <Badge className="ml-auto bg-orange-500 text-white tabular-nums">{pendingOrders.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-4 flex flex-col gap-3">
          {pendingOrders.map((order: any) => (
            <div key={order.id} className="rounded-lg border border-orange-200 bg-white px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-primary text-sm">{order.order_number}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(order.order_date)}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 flex gap-2 flex-wrap">
                  <span>{order.item_count} item{Number(order.item_count) !== 1 ? "s" : ""}</span>
                  <span className="text-border">·</span>
                  <span className="font-medium text-foreground">{formatCurrency(order.total_amount)}</span>
                  {order.portal_notes && (
                    <>
                      <span className="text-border">·</span>
                      <span className="italic truncate max-w-[200px]">{order.portal_notes}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="border-red-200 text-red-700 hover:bg-red-50"
                  onClick={() => setRejectTarget(order)}
                  disabled={rejectMutation.isPending}
                >
                  Reject
                </Button>
                <Button
                  size="sm"
                  onClick={() => submitMutation.mutate(order.id)}
                  disabled={submitMutation.isPending}
                >
                  {submitMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                  Submit to SBS
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={!!rejectTarget} onOpenChange={(o) => { if (!o) { setRejectTarget(null); setRejectReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject order {rejectTarget?.order_number}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="reject-reason">Reason (optional)</Label>
            <Textarea
              id="reject-reason"
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="Let the team member know why this order was rejected…"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectTarget(null); setRejectReason(""); }}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={rejectMutation.isPending}
              onClick={() => rejectMutation.mutate({ orderId: rejectTarget.id, reason: rejectReason })}
            >
              {rejectMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
              Confirm reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { isManager, user } = useAuth();
  const firstName = (user as any)?.firstName ?? "there";

  // Computed once per render (consistent for the whole session)
  const welcome = useMemo(() => getWelcomeMessage(firstName), [firstName]);

  // Fade banner out after 10 s, then remove from DOM after the 1 s transition
  const [bannerFading, setBannerFading] = useState(false);
  const [bannerGone, setBannerGone] = useState(false);
  useEffect(() => {
    const fade = setTimeout(() => setBannerFading(true), 10_000);
    const gone = setTimeout(() => setBannerGone(true), 11_000);
    return () => { clearTimeout(fade); clearTimeout(gone); };
  }, []);

  const { data: orders = [], isLoading } = useQuery<any[]>({
    queryKey: ["portal-orders"],
    queryFn: () => apiFetch("/portal/orders"),
  });

  return (
    <PortalLayout>
      {/* Welcome banner — fades out after 10 s */}
      {!bannerGone && (
        <div
          className={`rounded-xl bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border border-primary/20 px-6 py-5 mb-6 transition-opacity duration-1000 ${bannerFading ? "opacity-0" : "opacity-100"}`}
        >
          <div className="flex items-start gap-3">
            <span className="text-3xl leading-none mt-0.5" role="img" aria-hidden>{welcome.emoji}</span>
            <div>
              <h2 className="text-xl font-semibold text-foreground">{welcome.greeting}</h2>
              <p className="text-muted-foreground text-sm mt-1 max-w-2xl leading-relaxed">
                {welcome.body}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Orders</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Track your order history and status</p>
        </div>
        <Button onClick={() => setLocation("/orders/new")} className="gap-1.5">
          <Plus className="w-4 h-4" /> New Order
        </Button>
      </div>

      {isManager && <ManagerReviewPanel />}

      {isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : orders.length === 0 ? (
        <Card>
          <CardContent className="py-20 text-center">
            <ShoppingBag className="w-14 h-14 mx-auto mb-4 text-muted-foreground/30" />
            <h2 className="text-lg font-semibold text-foreground">No orders yet</h2>
            <p className="text-muted-foreground text-sm mt-1 mb-6">Place your first order to get started</p>
            <Button onClick={() => setLocation("/orders/new")}>
              <Plus className="w-4 h-4 mr-1.5" /> Place an order
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {orders.map((order: any) => (
            <Card
              key={order.id}
              className="cursor-pointer hover:border-primary/40 hover:shadow-sm transition-all group"
              onClick={() => setLocation(`/orders/${order.id}`)}
            >
              <CardContent className="py-4 px-5 flex items-center gap-4">
                <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  <Package className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-primary">{order.order_number}</span>
                    <StatusBadge status={order.status} portalStatus={order.portal_status} />
                  </div>
                  <div className="text-sm text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                    <span>{formatDate(order.order_date)}</span>
                    <span className="text-border">·</span>
                    <span>{order.item_count} item{Number(order.item_count) !== 1 ? "s" : ""}</span>
                    {order.required_date && (
                      <>
                        <span className="text-border">·</span>
                        <span>Required {formatDate(order.required_date)}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-semibold tabular-nums">{formatCurrency(order.total_amount)}</span>
                  <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PortalLayout>
  );
}
