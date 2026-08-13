import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Auth minimal untuk dashboard single-user: satu password (env var), bukan
 * sistem akun. Server yang menerbitkan & memverifikasi token — token TIDAK
 * pernah dipercaya begitu saja dari client, setiap server function sensitif
 * (catat/edit/hapus trade, baca P&L, baca snapshot) wajib panggil
 * verifySessionToken() dulu sebelum jalan.
 *
 * Token = "<expiry_ms>.<hmac_base64url>", ditandatangani pakai
 * DASHBOARD_SESSION_SECRET lewat Web Crypto (bukan Node `crypto`/`Buffer`,
 * supaya jalan di runtime Cloudflare Workers juga).
 *
 * Env var yang wajib di-set di server (BUKAN VITE_-prefixed — jangan pernah
 * expose ke client):
 *   DASHBOARD_PASSWORD        -> password login kamu
 *   DASHBOARD_SESSION_SECRET  -> string acak panjang, buat sign token (beda
 *                                 dari password, mis. hasil `openssl rand -hex 32`)
 */

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 hari

function getPassword(): string | null {
  return process.env.DASHBOARD_PASSWORD || null;
}

function getSecret(): string | null {
  return process.env.DASHBOARD_SESSION_SECRET || null;
}

function toBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return toBase64Url(sig);
}

// Perbandingan waktu-konstan supaya panjang/isi password & signature tidak
// bisa ditebak dari perbedaan waktu respons.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function issueSessionToken(): Promise<string | null> {
  const secret = getSecret();
  if (!secret) return null;
  const payload = String(Date.now() + SESSION_TTL_MS);
  const sig = await hmac(secret, payload);
  return `${payload}.${sig}`;
}

export async function verifySessionToken(token: string | undefined | null): Promise<boolean> {
  const secret = getSecret();
  if (!secret || !token) return false;
  const dot = token.indexOf(".");
  if (dot < 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await hmac(secret, payload);
  if (!timingSafeEqual(sig, expected)) return false;
  const expiry = Number(payload);
  if (!Number.isFinite(expiry) || Date.now() > expiry) return false;
  return true;
}

/** Dipanggil di awal setiap server function sensitif. Melempar error dengan
 * pesan tetap "unauthorized" supaya client bisa deteksi & balik ke layar
 * login — lihat penanganannya di src/routes/index.tsx. */
export async function requireSession(token: string | undefined): Promise<void> {
  const ok = await verifySessionToken(token);
  if (!ok) throw new Error("unauthorized");
}

const loginSchema = z.object({ password: z.string().min(1) });

export const login = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => loginSchema.parse(data))
  .handler(async ({ data }): Promise<{ ok: boolean; token?: string; reason?: string }> => {
    const expected = getPassword();
    const secret = getSecret();
    if (!expected || !secret) {
      return { ok: false, reason: "server_not_configured" };
    }
    if (!timingSafeEqual(data.password, expected)) {
      return { ok: false, reason: "wrong_password" };
    }
    const token = await issueSessionToken();
    if (!token) return { ok: false, reason: "server_not_configured" };
    return { ok: true, token };
  });
