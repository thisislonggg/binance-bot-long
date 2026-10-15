/**
 * Saklar utama semua otomatisasi bot (auto-push harga, auto-verify liveness, auto-sync).
 *
 * Disimpan di server agar berlaku untuk semua tab/perangkat sekaligus, dan ditegakkan di sisi
 * server: push harga otomatis & auto-verify ditolak walau ada tab lama yang masih berjalan.
 * Pengaturan masing-masing bot tidak diubah, jadi saat dinyalakan lagi semuanya kembali seperti semula.
 * Aksi manual merchant (tombol Push API / Auto-Verif) tetap bisa dipakai.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSession } from "./auth";
import { getSupabase } from "./supabase";

const MASTER_SWITCH_KEY = "bot_master_switch";
const CACHE_TTL_MS = 3_000;

export type BotMasterSwitch = { enabled: boolean; updatedAt: number };

type Store = { value: BotMasterSwitch; readAt: number };
// globalThis: modul server bisa termuat dua kali (chunk terpisah per server function).
const g = globalThis as unknown as { __p2pBotMasterSwitch?: Store };
const store = (): Store => (g.__p2pBotMasterSwitch ??= { value: { enabled: true, updatedAt: 0 }, readAt: 0 });

export async function getBotMasterSwitchInternal(opts: { fresh?: boolean } = {}): Promise<BotMasterSwitch> {
  const s = store();
  if (!opts.fresh && Date.now() - s.readAt < CACHE_TTL_MS) return s.value;
  const db = getSupabase();
  if (!db) return s.value;
  try {
    const { data, error } = await db.from("user_settings").select("value").eq("key", MASTER_SWITCH_KEY).maybeSingle();
    const row = data as { value?: string } | null;
    if (!error) {
      if (row?.value) {
        const parsed = JSON.parse(row.value) as Partial<BotMasterSwitch>;
        s.value = { enabled: parsed.enabled !== false, updatedAt: Number(parsed.updatedAt) || 0 };
      } else {
        s.value = { enabled: true, updatedAt: 0 };
      }
      s.readAt = Date.now();
    }
  } catch {
    // Gagal baca: pakai nilai terakhir yang diketahui.
  }
  return s.value;
}

export async function isBotAutomationEnabled(): Promise<boolean> {
  return (await getBotMasterSwitchInternal()).enabled;
}

export const getBotMasterSwitch = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ sessionToken: z.string().optional() }).parse(data))
  .handler(async ({ data }): Promise<BotMasterSwitch> => {
    await requireSession(data.sessionToken);
    return getBotMasterSwitchInternal({ fresh: true });
  });

export const setBotMasterSwitch = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z.object({ sessionToken: z.string().optional(), enabled: z.boolean() }).parse(data),
  )
  .handler(async ({ data }): Promise<BotMasterSwitch & { ok: boolean; error?: string }> => {
    await requireSession(data.sessionToken);
    const value: BotMasterSwitch = { enabled: data.enabled, updatedAt: Date.now() };
    const s = store();
    const db = getSupabase();
    if (db) {
      const { error } = await db
        .from("user_settings")
        .upsert({ key: MASTER_SWITCH_KEY, value: JSON.stringify(value) } as any, { onConflict: "key" });
      if (error) return { ...s.value, ok: false, error: error.message };
    }
    s.value = value;
    s.readAt = Date.now();
    console.log(`[MASTER-SWITCH] Semua otomatisasi bot ${value.enabled ? "DINYALAKAN" : "DIMATIKAN"}.`);
    return { ...value, ok: true };
  });
