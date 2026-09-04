import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ShieldCheck,
  Bell,
  BellRing,
  Send,
  RefreshCw,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  Info,
  Smartphone,
  Check,
  Volume2,
  VolumeX,
  Plus,
  ArrowUpRight,
  Clock,
  User,
  CreditCard,
  Copy,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  getVerifierState,
  saveVerifierSettings,
  updateBaselineBalance,
  checkBalanceDelta,
  sendTestWhatsApp,
  type VerifierSettings,
  type ActiveP2pOrder,
  type AlertLog,
} from "@/lib/payment-verifier";

interface PaymentVerifierPanelProps {
  sessionToken?: string | null;
}

// ── Audio Alert Synthesizer (Web Audio API - Nada Lonceng Merdu) ────────────
function playPaymentChime() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const now = ctx.currentTime;

    // Nada 1: C6 (1046.5 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(1046.5, now);
    gain1.gain.setValueAtTime(0.3, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.8);

    // Nada 2: E6 (1318.5 Hz) - selang 0.15 detik
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(1318.5, now + 0.15);
    gain2.gain.setValueAtTime(0.35, now + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.15);
    osc2.stop(now + 1.2);
  } catch {
    // Abaikan jika browser membatasi audio autoplay
  }
}

export function PaymentVerifierPanel({ sessionToken }: PaymentVerifierPanelProps) {
  // Query state verifier (auto-poll tiap 10 detik)
  const verifierQuery = useQuery({
    queryKey: ["payment-verifier-state"],
    queryFn: () => getVerifierState({ data: { sessionToken: sessionToken ?? undefined } }),
    enabled: Boolean(sessionToken),
    refetchInterval: 10_000,
  });

  const state = verifierQuery.data;

  // Local state form pengaturan
  const [waPhone, setWaPhone] = useState("");
  const [waProvider, setWaProvider] = useState<VerifierSettings["wa_provider"]>("fonnte");
  const [waApiToken, setWaApiToken] = useState("");
  const [waCustomUrl, setWaCustomUrl] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [isEditingSettings, setIsEditingSettings] = useState(false);

  // Local state input saldo & simulasi
  const [manualBalanceInput, setManualBalanceInput] = useState("");

  // Sync state dari server ke local form saat data siap
  useEffect(() => {
    if (state?.settings) {
      setWaPhone(state.settings.wa_phone || "");
      setWaProvider(state.settings.wa_provider || "fonnte");
      setWaApiToken(state.settings.wa_api_token || "");
      setWaCustomUrl(state.settings.wa_custom_url || "");
      setSoundEnabled(state.settings.sound_enabled ?? true);
      setTelegramEnabled(state.settings.telegram_enabled ?? false);
      setTelegramBotToken(state.settings.telegram_bot_token || "");
      setTelegramChatId(state.settings.telegram_chat_id || "");
    }
  }, [state?.settings]);

  // Mutasi simpan pengaturan
  const saveSettingsMutation = useMutation({
    mutationFn: (settings: VerifierSettings) =>
      saveVerifierSettings({ data: { sessionToken: sessionToken ?? undefined, settings } }),
    onSuccess: () => {
      toast.success("Pengaturan notifikasi berhasil disimpan.");
      setIsEditingSettings(false);
      verifierQuery.refetch();
    },
    onError: (err: any) => toast.error(`Gagal menyimpan: ${err.message}`),
  });

  // Mutasi update baseline
  const updateBaselineMutation = useMutation({
    mutationFn: (baselineIdr: number) =>
      updateBaselineBalance({ data: { sessionToken: sessionToken ?? undefined, baselineIdr } }),
    onSuccess: (res) => {
      toast.success(`Saldo baseline berhasil disetel ke Rp ${res.baselineIdr.toLocaleString("id-ID")}`);
      verifierQuery.refetch();
    },
    onError: (err: any) => toast.error(`Gagal setel baseline: ${err.message}`),
  });

  // Mutasi tes kirim WhatsApp
  const testWaMutation = useMutation({
    mutationFn: () => sendTestWhatsApp({ data: { sessionToken: sessionToken ?? undefined } }),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Pesan tes WhatsApp berhasil terkirim!");
      } else {
        toast.error(`Gagal kirim WhatsApp: ${res.error || "Cek token/nomor"}`);
      }
    },
    onError: (err: any) => toast.error(`Error kirim WhatsApp: ${err.message}`),
  });

  // Mutasi cek delta saldo
  const checkBalanceMutation = useMutation({
    mutationFn: (newBalanceIdr: number) =>
      checkBalanceDelta({ data: { sessionToken: sessionToken ?? undefined, newBalanceIdr } }),
    onSuccess: (res) => {
      verifierQuery.refetch();
      setManualBalanceInput("");

      if (res.matched) {
        if (soundEnabled) playPaymentChime();

        if (res.alertType === "single_match") {
          toast.success(res.message, { duration: 8000 });
        } else if (res.alertType === "simultaneous_match") {
          toast.success(res.message, { duration: 10000 });
        } else {
          toast.warning(res.message, { duration: 10000 });
        }

        if (res.waSent) {
          toast.info("Notifikasi WhatsApp berhasil dikirim ke HP Anda.");
        } else if (res.waError) {
          toast.error(`WA tidak terkirim: ${res.waError}`);
        }
      } else {
        toast.info(res.message);
      }
    },
    onError: (err: any) => toast.error(`Gagal cek saldo: ${err.message}`),
  });

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    saveSettingsMutation.mutate({
      wa_phone: waPhone,
      wa_provider: waProvider,
      wa_api_token: waApiToken,
      wa_custom_url: waCustomUrl,
      sound_enabled: soundEnabled,
      telegram_enabled: telegramEnabled,
      telegram_bot_token: telegramBotToken,
      telegram_chat_id: telegramChatId,
    });
  };

  const handleUpdateBalance = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanNum = Number(manualBalanceInput.replace(/[^0-9]/g, ""));
    if (cleanNum <= 0) {
      toast.error("Masukkan angka saldo yang valid!");
      return;
    }
    checkBalanceMutation.mutate(cleanNum);
  };

  const handleSimulatePayment = (order: ActiveP2pOrder) => {
    const currentBase = state?.baselineBalanceIdr ?? 20_000_000;
    const simNewBalance = currentBase + order.totalPriceIdr;
    checkBalanceMutation.mutate(simNewBalance);
  };

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} disalin ke clipboard`);
  };

  const activeOrders = state?.activeOrders ?? [];
  const baseline = state?.baselineBalanceIdr ?? 0;
  const recentLogs = state?.recentLogs ?? [];

  return (
    <div className="space-y-5">
      {/* ── Header & Banner Status Verifier ──────────────────────────────── */}
      <div className="panel p-4.5 border-primary/25 bg-gradient-to-br from-surface to-primary/5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-primary/15 p-2.5 text-primary border border-primary/30 shadow-sm shadow-primary/10">
              <ShieldCheck className="size-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-foreground">
                  Pemantau Saldo Bank & Verifikasi Pembayaran P2P
                </h2>
                <Badge variant={baseline > 0 ? "bid" : "outline"} className="text-[0.65rem] px-2 py-0.5">
                  {baseline > 0 ? "Aktif & Siaga" : "Menunggu Setup"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Mendeteksi dana masuk ke rekening BRI secara otomatis, mencocokkan dengan order aktif, dan mengirimkan alert instan ke WhatsApp.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => verifierQuery.refetch()}
              disabled={verifierQuery.isFetching}
              className="h-8 text-xs gap-1.5 bg-surface"
            >
              <RefreshCw className={`size-3.5 ${verifierQuery.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              variant={isEditingSettings ? "default" : "outline"}
              size="sm"
              onClick={() => setIsEditingSettings(!isEditingSettings)}
              className="h-8 text-xs gap-1.5 bg-surface hover:bg-surface-3"
            >
              <Sliders className="size-3.5" />
              {isEditingSettings ? "Tutup Pengaturan" : "Pengaturan Notifikasi"}
            </Button>
          </div>
        </div>

        {/* 3 Kartu Metrik Ringkas */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
          {/* Kartu 1: Saldo Terpantau */}
          <div className="rounded-xl border border-border/70 bg-surface/80 p-3.5 space-y-1.5">
            <span className="text-[0.68rem] text-muted-foreground uppercase font-semibold tracking-wider">
              Saldo Baseline Terpantau
            </span>
            <div className="num font-bold text-foreground text-lg">
              {baseline > 0 ? `Rp ${baseline.toLocaleString("id-ID")}` : "Belum Disetel"}
            </div>
            <div className="flex items-center justify-between text-[0.7rem] text-muted-foreground">
              <span>Rekening: BRI</span>
              {baseline > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const val = prompt("Setel ulang saldo baseline (Rupiah):", String(baseline));
                    if (val) {
                      const num = Number(val.replace(/[^0-9]/g, ""));
                      if (num > 0) updateBaselineMutation.mutate(num);
                    }
                  }}
                  className="text-primary hover:underline font-medium"
                >
                  Edit Baseline
                </button>
              )}
            </div>
          </div>

          {/* Kartu 2: Order Aktif Menunggu Dana */}
          <div className="rounded-xl border border-border/70 bg-surface/80 p-3.5 space-y-1.5">
            <span className="text-[0.68rem] text-muted-foreground uppercase font-semibold tracking-wider">
              Order Menunggu Pembayaran
            </span>
            <div className="num font-bold text-amber-400 text-lg flex items-center gap-2">
              {activeOrders.length} Order Aktif
              {activeOrders.length > 0 && (
                <span className="size-2 rounded-full bg-amber-400 animate-ping" />
              )}
            </div>
            <span className="text-[0.7rem] text-muted-foreground">
              Total: Rp {activeOrders.reduce((s, o) => s + o.totalPriceIdr, 0).toLocaleString("id-ID")}
            </span>
          </div>

          {/* Kartu 3: Target Notifikasi WhatsApp */}
          <div className="rounded-xl border border-border/70 bg-surface/80 p-3.5 space-y-1.5">
            <span className="text-[0.68rem] text-muted-foreground uppercase font-semibold tracking-wider">
              Tujuan Notifikasi WhatsApp
            </span>
            <div className="font-bold text-foreground text-base truncate flex items-center gap-1.5">
              <Smartphone className="size-4 text-emerald-400 shrink-0" />
              {state?.settings.wa_phone ? state.settings.wa_phone : "Belum diisi"}
            </div>
            <div className="flex items-center justify-between text-[0.7rem] text-muted-foreground">
              <span>Provider: {state?.settings.wa_provider || "Fonnte"}</span>
              {state?.settings.wa_phone && (
                <button
                  type="button"
                  onClick={() => testWaMutation.mutate()}
                  disabled={testWaMutation.isPending}
                  className="text-emerald-400 hover:underline font-medium flex items-center gap-1"
                >
                  <Send className="size-2.5" />
                  {testWaMutation.isPending ? "Mengirim…" : "Tes Kirim"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Panel Konfigurasi Notifikasi WhatsApp (Jika Dibuka) ──────────── */}
      {isEditingSettings && (
        <div className="panel p-5 border-primary/30 bg-surface-2/60 space-y-4 animate-in fade-in-50">
          <div className="flex items-center justify-between border-b border-border/60 pb-3">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-emerald-500/15 p-2 text-emerald-400 border border-emerald-500/30">
                <Smartphone className="size-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-foreground">
                  Konfigurasi Notifikasi WhatsApp & Alarm
                </h3>
                <p className="text-xs text-muted-foreground">
                  Pesan alert instan akan dikirimkan ke nomor ini ketika mutasi dana masuk cocok dengan tagihan order.
                </p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setIsEditingSettings(false)} className="h-7 text-xs">
              Tutup
            </Button>
          </div>

          <form onSubmit={handleSaveSettings} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Nomor WhatsApp */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">Nomor WhatsApp Tujuan:</Label>
                <Input
                  type="text"
                  placeholder="contoh: 08123456789 atau 628123456789"
                  value={waPhone}
                  onChange={(e) => setWaPhone(e.target.value)}
                  className="bg-surface text-xs font-semibold num"
                />
                <p className="text-[0.68rem] text-muted-foreground">
                  Bisa nomor HP utama Anda (bot mengirim via chat mandiri).
                </p>
              </div>

              {/* Provider WhatsApp */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">Layanan Gateway WhatsApp:</Label>
                <select
                  value={waProvider}
                  onChange={(e) => setWaProvider(e.target.value as any)}
                  className="w-full h-9 rounded-md border border-input bg-surface px-3 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="fonnte">Fonnte (Gratis Kuota & Paling Stabil di Indo)</option>
                  <option value="local_gateway">Local Service (Baileys/Node.js di PC: 3001)</option>
                  <option value="wablas">Wablas</option>
                  <option value="custom_webhook">Custom Webhook Send URL</option>
                </select>
                <p className="text-[0.68rem] text-muted-foreground">
                  {waProvider === "fonnte" ? "Daftar gratis di fonnte.com dan ambil token API." : "Layanan pengirim pesan WhatsApp."}
                </p>
              </div>

              {/* Token API / Custom URL */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">
                  {waProvider === "custom_webhook" || waProvider === "local_gateway" ? "URL Endpoint Gateway:" : "API Token Gateway:"}
                </Label>
                {waProvider === "custom_webhook" || waProvider === "local_gateway" ? (
                  <Input
                    type="text"
                    placeholder="http://127.0.0.1:3001/send-message"
                    value={waCustomUrl}
                    onChange={(e) => setWaCustomUrl(e.target.value)}
                    className="bg-surface text-xs"
                  />
                ) : (
                  <Input
                    type="password"
                    placeholder="Masukkan API Token..."
                    value={waApiToken}
                    onChange={(e) => setWaApiToken(e.target.value)}
                    className="bg-surface text-xs"
                  />
                )}
                <p className="text-[0.68rem] text-muted-foreground">
                  Kunci otorisasi pengiriman pesan WhatsApp.
                </p>
              </div>
            </div>

            {/* Opsi Audio & Telegram */}
            <div className="flex flex-wrap items-center gap-6 pt-2 border-t border-border/50">
              <div className="flex items-center gap-2">
                <Switch
                  id="sound-switch"
                  checked={soundEnabled}
                  onCheckedChange={setSoundEnabled}
                />
                <Label htmlFor="sound-switch" className="text-xs cursor-pointer text-foreground flex items-center gap-1.5">
                  {soundEnabled ? <Volume2 className="size-4 text-primary" /> : <VolumeX className="size-4 text-muted-foreground" />}
                  Bunyikan Alarm Suara di Komputer saat Dana Masuk
                </Label>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  id="tg-switch"
                  checked={telegramEnabled}
                  onCheckedChange={setTelegramEnabled}
                />
                <Label htmlFor="tg-switch" className="text-xs cursor-pointer text-foreground flex items-center gap-1.5">
                  <Send className="size-3.5 text-sky-400" />
                  Aktifkan Cadangan Telegram Bot
                </Label>
              </div>

              {soundEnabled && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => playPaymentChime()}
                  className="h-7 text-[0.7rem] bg-surface"
                >
                  <Volume2 className="size-3 mr-1" />
                  Tes Suara Lonceng
                </Button>
              )}
            </div>

            {/* Form Telegram jika diaktifkan */}
            {telegramEnabled && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg bg-surface border border-sky-500/20">
                <div className="space-y-1">
                  <Label className="text-[0.7rem] text-muted-foreground">Telegram Bot Token:</Label>
                  <Input
                    type="password"
                    placeholder="1234567890:ABCdefGHIjkl..."
                    value={telegramBotToken}
                    onChange={(e) => setTelegramBotToken(e.target.value)}
                    className="h-8 text-xs bg-surface-2"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[0.7rem] text-muted-foreground">Telegram Chat ID Anda:</Label>
                  <Input
                    type="text"
                    placeholder="contoh: 987654321"
                    value={telegramChatId}
                    onChange={(e) => setTelegramChatId(e.target.value)}
                    className="h-8 text-xs bg-surface-2 num"
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/50">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => testWaMutation.mutate()}
                disabled={testWaMutation.isPending || !waPhone}
                className="h-8 text-xs gap-1.5"
              >
                <Send className="size-3 text-emerald-400" />
                {testWaMutation.isPending ? "Mengirim Pesan Tes…" : "Kirim Pesan Tes WhatsApp"}
              </Button>

              <Button
                type="submit"
                size="sm"
                disabled={saveSettingsMutation.isPending}
                className="h-8 text-xs font-semibold gap-1.5"
              >
                <Check className="size-3.5" />
                Simpan Pengaturan
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* ── Section Order P2P Aktif Menunggu Dana & Input Saldo ─────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Kolom Kiri (2 Kolom): Tabel Order Aktif Menunggu Dana */}
        <div className="lg:col-span-2 panel p-4.5 space-y-4">
          <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
            <div className="flex items-center gap-2">
              <Clock className="size-4 text-amber-400" />
              <h3 className="text-sm font-bold text-foreground uppercase tracking-wide">
                Order P2P Aktif Menunggu Pembayaran ({activeOrders.length})
              </h3>
            </div>
            <span className="text-[0.7rem] text-muted-foreground">
              Auto-refresh tiap 10 detik dari Binance
            </span>
          </div>

          {activeOrders.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/80 p-8 text-center space-y-2">
              <CheckCircle2 className="size-8 text-emerald-400/80 mx-auto" />
              <p className="text-sm font-semibold text-foreground">Tidak Ada Order Menunggu Pembayaran</p>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                Saat pembeli mengklik &ldquo;Saya sudah transfer&rdquo; di Binance, order penjualan Anda akan langsung muncul di sini dan dipantau mutasinya secara otomatis.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {activeOrders.map((ord) => (
                <div
                  key={ord.orderNumber}
                  className="rounded-xl border border-amber-500/30 bg-gradient-to-r from-surface to-amber-500/5 p-3.5 flex flex-wrap items-center justify-between gap-3 transition-all hover:border-amber-500/50"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[0.65rem] border-amber-500/40 text-amber-400 font-semibold uppercase">
                        {ord.orderStatus || "MENUNGGU DANA"}
                      </Badge>
                      <button
                        type="button"
                        onClick={() => handleCopy(ord.orderNumber, "Nomor order")}
                        className="text-xs font-mono font-bold text-foreground hover:text-primary transition-colors flex items-center gap-1"
                        title="Klik untuk salin order number"
                      >
                        #{ord.orderNumber.slice(-8)}
                        <Copy className="size-2.5 text-muted-foreground" />
                      </button>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="text-xs font-medium text-foreground/90 flex items-center gap-1">
                        <User className="size-3 text-muted-foreground" />
                        @{ord.counterPartNickName}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span>Kripto: <strong className="text-foreground">{ord.amountUsdt.toLocaleString("id-ID")} USDT</strong></span>
                      <span>Kurs: Rp {ord.unitPriceIdr.toLocaleString("id-ID")}</span>
                      {ord.payMethodName && (
                        <span className="flex items-center gap-1 text-[0.7rem] bg-surface-2 px-1.5 py-0.5 rounded border border-border">
                          <CreditCard className="size-3" />
                          {ord.payMethodName}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Tagihan Nominal IDR & Tombol Uji Coba */}
                  <div className="flex items-center gap-3 text-right">
                    <div>
                      <span className="text-[0.65rem] text-muted-foreground uppercase font-semibold">Nominal Tagihan</span>
                      <div className="num font-extrabold text-base text-emerald-400">
                        Rp {ord.totalPriceIdr.toLocaleString("id-ID")}
                      </div>
                    </div>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleSimulatePayment(ord)}
                      disabled={checkBalanceMutation.isPending}
                      className="h-8 text-xs gap-1 bg-surface-2 hover:bg-emerald-500/20 border-emerald-500/30 text-emerald-400"
                      title="Simulasikan seolah saldo bank naik pas sebesar nominal ini"
                    >
                      <ArrowUpRight className="size-3" />
                      Tes Dana Masuk
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Kolom Kanan (1 Kolom): Input & Update Saldo Bank Manual/Emulator */}
        <div className="panel p-4.5 space-y-4">
          <div className="border-b border-border/60 pb-2.5">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2 uppercase tracking-wide">
              <CreditCard className="size-4 text-primary" />
              Update Saldo Rekening BRI
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Masukkan angka saldo terbaru untuk mengecek apakah ada dana yang cocok.
            </p>
          </div>

          <form onSubmit={handleUpdateBalance} className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">
                Saldo Bank Saat Ini (Rupiah):
              </Label>
              <Input
                type="text"
                placeholder="contoh: 37585000"
                value={manualBalanceInput}
                onChange={(e) => setManualBalanceInput(e.target.value)}
                className="h-9 bg-surface text-sm font-bold num"
              />
              <span className="text-[0.68rem] text-muted-foreground">
                Baseline sebelumnya: <strong>Rp {baseline.toLocaleString("id-ID")}</strong>
              </span>
            </div>

            <Button
              type="submit"
              size="sm"
              disabled={checkBalanceMutation.isPending || !manualBalanceInput}
              className="w-full h-9 text-xs font-semibold gap-1.5"
            >
              <Check className="size-3.5" />
              {checkBalanceMutation.isPending ? "Mengecek Kecocokan…" : "Verifikasi Kenaikan Saldo"}
            </Button>
          </form>

          {/* Quick Simulation Buttons */}
          <div className="space-y-2 pt-2 border-t border-border/60">
            <span className="text-xs font-semibold text-muted-foreground">Simulasi Cepat (Test Delta):</span>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const target = baseline + 5_000_000;
                  checkBalanceMutation.mutate(target);
                }}
                className="h-7 text-[0.7rem] bg-surface"
              >
                +Rp 5.000.000
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const target = baseline + 10_000_000;
                  checkBalanceMutation.mutate(target);
                }}
                className="h-7 text-[0.7rem] bg-surface"
              >
                +Rp 10.000.000
              </Button>
            </div>
            <p className="text-[0.65rem] text-muted-foreground leading-relaxed">
              💡 <strong>Tips Otomatis:</strong> Anda juga bisa menjalankan script background pembaca layar BRImo di PC agar input saldo ini berjalan otomatis 100% tanpa ketik manual.
            </p>
          </div>
        </div>
      </div>

      {/* ── Log Riwayat Pembayaran & Alert Masuk ─────────────────────────── */}
      <div className="panel p-4.5 space-y-3">
        <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
          <div className="flex items-center gap-2">
            <Bell className="size-4 text-primary" />
            <h3 className="text-sm font-bold text-foreground uppercase tracking-wide">
              Riwayat Deteksi Dana Masuk & Notifikasi
            </h3>
          </div>
          <span className="text-xs text-muted-foreground num">
            {recentLogs.length} Log Terakhir
          </span>
        </div>

        {recentLogs.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            Belum ada riwayat mutasi dana masuk yang terdeteksi hari ini.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[0.68rem] text-muted-foreground uppercase border-b border-border/60">
                  <th className="py-2 pr-3 text-left font-semibold">Waktu</th>
                  <th className="py-2 pr-3 text-left font-semibold">Tipe Alert</th>
                  <th className="py-2 pr-3 text-right font-semibold">Delta Saldo</th>
                  <th className="py-2 pr-3 text-right font-semibold">Saldo Akhir</th>
                  <th className="py-2 pr-3 text-left font-semibold">Keterangan & Order Cocok</th>
                  <th className="py-2 text-center font-semibold">Status WA</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {recentLogs.map((log) => {
                  const dateStr = new Date(log.ts).toLocaleTimeString("id-ID", {
                    timeZone: "Asia/Jakarta",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  });

                  return (
                    <tr key={log.id} className="hover:bg-surface-2/40 transition-colors">
                      <td className="py-2.5 pr-3 text-muted-foreground font-mono">{dateStr} WIB</td>
                      <td className="py-2.5 pr-3">
                        {log.type === "single_match" && (
                          <Badge variant="bid" className="text-[0.62rem] gap-1">
                            <Check className="size-2.5" /> Order Cocok
                          </Badge>
                        )}
                        {log.type === "simultaneous_match" && (
                          <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30 text-[0.62rem] gap-1">
                            <Check className="size-2.5" /> Serentak ({log.matchedOrders.length})
                          </Badge>
                        )}
                        {log.type === "identical_alert" && (
                          <Badge variant="destructive" className="text-[0.62rem] gap-1">
                            <AlertTriangle className="size-2.5" /> Order Kembar
                          </Badge>
                        )}
                        {log.type === "underpaid_alert" && (
                          <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-[0.62rem] gap-1">
                            <AlertTriangle className="size-2.5" /> Kurang
                          </Badge>
                        )}
                        {log.type === "info" && (
                          <Badge variant="outline" className="text-[0.62rem]">
                            Info
                          </Badge>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-right num font-bold text-emerald-400">
                        {log.deltaIdr > 0 ? `+Rp ${log.deltaIdr.toLocaleString("id-ID")}` : `Rp ${log.deltaIdr.toLocaleString("id-ID")}`}
                      </td>
                      <td className="py-2.5 pr-3 text-right num text-foreground/80">
                        Rp {log.newBalanceIdr.toLocaleString("id-ID")}
                      </td>
                      <td className="py-2.5 pr-3 text-foreground/90 max-w-md">
                        <div className="line-clamp-2 leading-relaxed">{log.message}</div>
                      </td>
                      <td className="py-2.5 text-center">
                        {log.waSent ? (
                          <span className="inline-flex items-center gap-1 text-[0.65rem] text-emerald-400 font-semibold">
                            <Check className="size-3" /> Terkirim
                          </span>
                        ) : log.waError ? (
                          <span className="inline-flex items-center gap-1 text-[0.65rem] text-rose-400" title={log.waError}>
                            <AlertTriangle className="size-3" /> Gagal
                          </span>
                        ) : (
                          <span className="text-[0.65rem] text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
