/**
 * Parser dan importir CSV riwayat transaksi C2C / P2P dari Binance.
 * Membantu merchant mengimpor seluruh data riwayat tanpa terhalang geoblock IP server.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSession } from "./auth";
import { getSupabase } from "./supabase";

export type ImportCsvResult = {
  ok: boolean;
  added: number;
  skipped: number;
  totalParsed: number;
  error?: string;
};

/**
 * Parsing teks CSV menjadi baris-baris objek dengan deteksi delimiter otomatis (, atau ; atau \t).
 */
function parseCsvRows(csvText: string): Array<Record<string, string>> {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) return [];

  // Deteksi delimiter dari header (koma, titik koma, atau tab)
  const headerLine = lines[0]!;
  let delimiter = ",";
  if (headerLine.includes(";") && headerLine.split(";").length > headerLine.split(",").length) {
    delimiter = ";";
  } else if (headerLine.includes("\t") && headerLine.split("\t").length > headerLine.split(",").length) {
    delimiter = "\t";
  }

  // Helper untuk memecah baris CSV dengan memperhitungkan tanda petik ganda
  const splitLine = (line: string): string[] => {
    const result: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQuotes = !inQuotes;
      } else if (c === delimiter && !inQuotes) {
        result.push(cur.trim().replace(/^"|"$/g, ""));
        cur = "";
      } else {
        cur += c;
      }
    }
    result.push(cur.trim().replace(/^"|"$/g, ""));
    return result;
  };

  const headers = splitLine(headerLine).map((h) => h.toLowerCase().replace(/[\s_\-()]/g, ""));
  const rows: Array<Record<string, string>> = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i]!);
    if (cols.length === 0) continue;
    const rowObj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      rowObj[h] = cols[idx] ?? "";
    });
    rows.push(rowObj);
  }

  return rows;
}

/**
 * Cari nilai dari record berdasarkan kemungkinan variasi nama header.
 */
function findVal(row: Record<string, string>, possibleKeys: string[]): string {
  for (const k of possibleKeys) {
    const normalized = k.toLowerCase().replace(/[\s_\-()]/g, "");
    if (row[normalized] !== undefined && row[normalized] !== "") {
      return row[normalized]!;
    }
  }
  return "";
}

const importCsvInputSchema = z.object({
  sessionToken: z.string().optional(),
  csvText: z.string().min(1, "Konten CSV tidak boleh kosong"),
});

export const importBinanceCsvTrades = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => importCsvInputSchema.parse(data))
  .handler(async ({ data }): Promise<ImportCsvResult> => {
    await requireSession(data.sessionToken);

    const db = getSupabase();
    if (!db) {
      return { ok: false, added: 0, skipped: 0, totalParsed: 0, error: "Supabase belum dikonfigurasi" };
    }

    const rows = parseCsvRows(data.csvText);
    if (rows.length === 0) {
      return { ok: false, added: 0, skipped: 0, totalParsed: 0, error: "Format file CSV tidak valid atau kosong" };
    }

    let added = 0;
    let skipped = 0;

    for (const row of rows) {
      // 1. Order Number
      const orderNo = findVal(row, [
        "ordernumber",
        "orderno",
        "orderid",
        "nopesanan",
        "idpesanan",
        "tradeid",
        "transid",
      ]);

      // 2. Status pesanan
      const status = findVal(row, ["status", "orderstatus", "statuspesanan"]).toUpperCase();
      // Hanya masukkan yang COMPLETED / SELESAI
      if (status && !status.includes("COMPLET") && !status.includes("SELESAI") && status !== "4") {
        skipped++;
        continue;
      }

      // 3. Side (Buy / Sell)
      const typeStr = findVal(row, ["type", "ordertype", "tradetype", "tipe", "jenis", "side"]).toUpperCase();
      let side: "buy" | "sell" = "buy";
      if (typeStr.includes("SELL") || typeStr.includes("JUAL")) {
        side = "sell";
      } else if (typeStr.includes("BUY") || typeStr.includes("BELI")) {
        side = "buy";
      } else {
        // Abaikan jika bukan Buy / Sell
        skipped++;
        continue;
      }

      // 4. Crypto amount (USDT)
      const amountStr = findVal(row, [
        "amount",
        "cryptoamount",
        "quantity",
        "jumlahkripto",
        "jumlah",
        "totalquantity",
      ]).replace(/,/g, "");
      const amountUsdt = parseFloat(amountStr);

      // 5. Total Fiat Price
      const totalStr = findVal(row, [
        "totalprice",
        "fiatamount",
        "totalharga",
        "totalfiat",
        "fiat",
        "amountidr",
      ]).replace(/,/g, "");
      const totalPrice = parseFloat(totalStr);

      // 6. Unit Price
      const priceStr = findVal(row, [
        "unitprice",
        "price",
        "hargasatuan",
        "harga",
        "rate",
      ]).replace(/,/g, "");
      let unitPrice = parseFloat(priceStr);

      if ((!Number.isFinite(unitPrice) || unitPrice <= 0) && totalPrice > 0 && amountUsdt > 0) {
        unitPrice = totalPrice / amountUsdt;
      }

      if (!Number.isFinite(amountUsdt) || amountUsdt <= 0 || !Number.isFinite(unitPrice) || unitPrice <= 0) {
        skipped++;
        continue;
      }

      // 7. Waktu transaksi
      const timeStr = findVal(row, ["createdtime", "date", "dateutc", "time", "waktudibuat", "tanggal", "createdat"]);
      let ts = new Date().toISOString();
      if (timeStr) {
        const parsedTime = new Date(timeStr);
        if (!isNaN(parsedTime.getTime())) {
          ts = parsedTime.toISOString();
        }
      }

      // 8. Counterparty & catatan
      const counterparty = findVal(row, ["counterparty", "counterpartynickname", "lawantransaksi", "partner"]);
      const payMethod = findVal(row, ["paymethod", "paymethodname", "metodepembayaran", "payment"]);
      const noteParts = [
        counterparty ? `@${counterparty}` : null,
        payMethod ?? null,
      ].filter(Boolean);
      const note = noteParts.length ? noteParts.join(" · ") : null;

      // 9. Cek deduplikasi jika ada orderNo
      if (orderNo) {
        const { data: existing } = await db
          .from("trades")
          .select("id")
          .eq("binance_order_no", orderNo)
          .maybeSingle();

        if (existing) {
          skipped++;
          continue;
        }
      }

      const { error } = await db.from("trades").insert({
        ts,
        side,
        price: unitPrice,
        amount_usdt: amountUsdt,
        note,
        source: "binance_sync",
        binance_order_no: orderNo || null,
      });

      if (!error) {
        added++;
      } else {
        skipped++;
      }
    }

    return {
      ok: true,
      added,
      skipped,
      totalParsed: rows.length,
    };
  });
