/**
 * Engine Analisis Sentimen Berita & Dampak Finansial Terhadap Harga USDT/IDR
 * Didesain khusus untuk memandu strategi pasang iklan dan perputaran modal Merchant P2P.
 */

export type NewsImpact = "bullish_usdt" | "bearish_usdt" | "volatility" | "neutral";
export type NewsImpactLevel = "high" | "medium" | "low";

export type AnalyzedNews = {
  title: string;
  link: string;
  source: string;
  published_time: string;
  impact: NewsImpact;
  impact_label: string;
  impact_level: NewsImpactLevel;
  impact_summary: string;
  merchant_advice: string;
  category: "kurs_rupiah" | "kebijakan_fed_bi" | "pasar_kripto" | "umum";
};

export type MacroSentiment = {
  overall_sentiment: "bullish" | "bearish" | "neutral" | "volatile";
  sentiment_label: string;
  bullish_count: number;
  bearish_count: number;
  volatility_count: number;
  neutral_count: number;
  action_summary: string;
};

// Keyword Dictionary untuk Klasifikasi Sentimen Kurs USDT/IDR
const BULLISH_KEYWORDS = [
  "melemah", "tertekan", "anjlok", "loyo", "jatuh", "dolar perkasa", "dolar menguat",
  "dolar as naik", "inflasi as", "hawkish", "capital outflow", "rupiah tembus",
  "rupiah terpuruk", "safe-haven", "permintaan safe haven", "bitcoin rekor", "ath",
  "kripto melonjak", "kripto melesat", "bull run", "etf kripto", "rally", "kripto meroket",
  "suku bunga the fed naik", "pertahankan suku bunga", "penurunan cadangan devisa"
];

const BEARISH_KEYWORDS = [
  "menguat", "rebound", "perkasa", "bangkit", "surplus", "cadangan devisa naik",
  "bi intervensi", "fed pangkas", "cut rate", "pemangkasan suku bunga", "dovish",
  "dolar anjlok", "dolar tertekan", "dolar melemah", "rupiah menguat", "inflow",
  "aliran modal masuk", "rupiah jadi raja", "rupiah unggul"
];

const VOLATILITY_KEYWORDS = [
  "pajak kripto", "ojk", "bappebti", "regulasi", "aturan baru", "sec", "tether",
  "hukum kripto", "pengetatan", "sidang", "audit", "gejolak", "fluktuasi", "uang palsu",
  "bank kripto", "trump", "kebijakan baru"
];

export function analyzeNewsHeadline(title: string, link: string, source: string = "Berita Finansial", pubDate?: string): AnalyzedNews {
  const lower = title.toLowerCase();

  let impact: NewsImpact = "neutral";
  let impactLevel: NewsImpactLevel = "low";
  let category: AnalyzedNews["category"] = "umum";

  // Deteksi Kategori
  if (lower.includes("rupiah") || lower.includes("dolar") || lower.includes("kurs") || lower.includes("valas")) {
    category = "kurs_rupiah";
  } else if (lower.includes("bi") || lower.includes("bank indonesia") || lower.includes("the fed") || lower.includes("suku bunga") || lower.includes("inflasi")) {
    category = "kebijakan_fed_bi";
  } else if (lower.includes("kripto") || lower.includes("bitcoin") || lower.includes("usdt") || lower.includes("tether") || lower.includes("blockchain")) {
    category = "pasar_kripto";
  }

  // Hitung Skor Sentimen
  let bullishMatches = 0;
  let bearishMatches = 0;
  let volatilityMatches = 0;

  for (const kw of BULLISH_KEYWORDS) {
    if (lower.includes(kw)) bullishMatches++;
  }
  for (const kw of BEARISH_KEYWORDS) {
    if (lower.includes(kw)) bearishMatches++;
  }
  for (const kw of VOLATILITY_KEYWORDS) {
    if (lower.includes(kw)) volatilityMatches++;
  }

  if (bullishMatches > bearishMatches && bullishMatches > 0) {
    impact = "bullish_usdt";
    impactLevel = bullishMatches >= 2 || lower.includes("anjlok") || lower.includes("terpuruk") ? "high" : "medium";
  } else if (bearishMatches > bullishMatches && bearishMatches > 0) {
    impact = "bearish_usdt";
    impactLevel = bearishMatches >= 2 || lower.includes("perkasa") || lower.includes("pangkas") ? "high" : "medium";
  } else if (volatilityMatches > 0) {
    impact = "volatility";
    impactLevel = volatilityMatches >= 2 ? "high" : "medium";
  }

  // Generate Penjelasan Dampak Finansial & Saran Merchant
  let impactLabel = "Netral (Stabil)";
  let impactSummary = "Sentimen pasar cenderung netral. Pergerakan harga USDT/IDR stabil mengikuti penawaran normal.";
  let merchantAdvice = "Pasang iklan dengan spread normal (Rp 35 - 50/USDT) untuk menjaga konsistensi perputaran.";

  if (impact === "bullish_usdt") {
    impactLabel = "Bullish USDT (+)";
    impactSummary = category === "pasar_kripto"
      ? "Kenaikan pasar kripto memicu lonjakan permintaan USDT dari para pembeli retail/institusi."
      : "Tekanan pada mata uang Rupiah / penguatan Dolar AS berpotensi mendorong kenaikan harga beli & jual USDT/IDR di pasar P2P.";
    merchantAdvice = "Peluang menaikkan harga pasang iklan jual. Tahan modal dan hindari melepas stok USDT di bawah nilai wajar.";
  } else if (impact === "bearish_usdt") {
    impactLabel = "Bearish USDT (-)";
    impactSummary = "Penguatan nilai tukar Rupiah terhadap Dolar AS berpotensi memberikan tekanan penurunan pada harga USDT/IDR.";
    merchantAdvice = "Percepat perputaran modal (turnover) dan pasang spread kompetitif agar stok lekas laku sebelum harga terkoreksi.";
  } else if (impact === "volatility") {
    impactLabel = "Volatilitas Tinggi (⚡)";
    impactSummary = "Berita regulasi, perbankan, atau kebijakan moneter berpotensi memicu lonjakan fluktuasi volume transaksi.";
    merchantAdvice = "Periksa batas minimum limit pesanan dan pantau buku pesanan secara berkala untuk mengantisipasi pergerakan mendadak.";
  }

  return {
    title,
    link,
    source,
    published_time: pubDate || "Baru saja",
    impact,
    impact_label: impactLabel,
    impact_level: impactLevel,
    impact_summary: impactSummary,
    merchant_advice: merchantAdvice,
    category,
  };
}

export function computeMacroSentiment(newsList: AnalyzedNews[]): MacroSentiment {
  if (!newsList.length) {
    return {
      overall_sentiment: "neutral",
      sentiment_label: "Sentimen Makro Netral / Stabil",
      bullish_count: 0,
      bearish_count: 0,
      volatility_count: 0,
      neutral_count: 0,
      action_summary: "Kondisi makro tenang. Jalankan perputaran modal normal sesuai spread acuan pasar.",
    };
  }

  let bullishCount = 0;
  let bearishCount = 0;
  let volatilityCount = 0;
  let neutralCount = 0;

  for (const n of newsList) {
    if (n.impact === "bullish_usdt") bullishCount++;
    else if (n.impact === "bearish_usdt") bearishCount++;
    else if (n.impact === "volatility") volatilityCount++;
    else neutralCount++;
  }

  let overall: MacroSentiment["overall_sentiment"] = "neutral";
  let label = "Sentimen Makro Seimbang";
  let action = "Pasang iklan dengan spread standar untuk memaksimalkan frekuensi transaksi harian.";

  if (bullishCount > bearishCount && bullishCount >= 2) {
    overall = "bullish";
    label = "Sentimen Makro Mendorong Kenaikan Harga USDT (+)";
    action = "Kondisi pasar menguntungkan sisi penjual USDT. Pertahankan batas harga jual optimal dan perlebar margin profit.";
  } else if (bearishCount > bullishCount && bearishCount >= 2) {
    overall = "bearish";
    label = "Sentimen Makro Berpotensi Menekan Harga USDT (-)";
    action = "Kondisi mengarah ke penguatan Rupiah. Prioritaskan kecepatan perputaran modal agar kas tidak tertahan lama.";
  } else if (volatilityCount >= 2) {
    overall = "volatile";
    label = "Volatilitas Pasar Diperkirakan Meningkat (⚡)";
    action = "Waspadai pergerakan spread mendadak. Pasang margin pengaman ekstra minimal +Rp 20/USDT dari modal.";
  }

  return {
    overall_sentiment: overall,
    sentiment_label: label,
    bullish_count: bullishCount,
    bearish_count: bearishCount,
    volatility_count: volatilityCount,
    neutral_count: neutralCount,
    action_summary: action,
  };
}
