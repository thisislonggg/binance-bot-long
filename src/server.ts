import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

import { handleIncomingBankNotificationWebhook } from "./lib/payment-verifier";
import { handleIncomingChatMessageWebhook } from "./lib/liveness-verifier";
import { runBackgroundBotTick } from "./lib/background-bot-engine";

let serverLoopStarted = false;
function ensureServerAutoPricingLoop() {
  if (serverLoopStarted) return;
  serverLoopStarted = true;
  // Menjalankan auto-pricing background loop otomatis setiap 20 detik selama server aktif
  setInterval(async () => {
    try {
      await runBackgroundBotTick();
    } catch {
      // Abaikan error di background loop
    }
  }, 20_000);
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      ensureServerAutoPricingLoop();
      const url = new URL(request.url);

      // Webhook / Cron 24/7 Otomatisasi Auto-Pricing (Dapat dipanggil Vercel Cron, pg_cron, atau cron-job.org)
      if (
        url.pathname === "/api/cron/auto-pricing" ||
        url.pathname === "/api/bot/auto-pricing-tick" ||
        url.pathname === "/api/bot/tick"
      ) {
        const result = await runBackgroundBotTick();
        return new Response(JSON.stringify(result, null, 2), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "access-control-allow-origin": "*",
            "cache-control": "no-store, no-cache, must-revalidate",
          },
        });
      }

      // Webhook Penerima Notifikasi Bank (MacroDroid / Android Push Notif Forwarder)
      if (url.pathname === "/api/webhook/bank-notification") {
        if (request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          const result = await handleIncomingBankNotificationWebhook(body);
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (request.method === "GET") {
          const text = url.searchParams.get("text") || "";
          const title = url.searchParams.get("title") || "";
          const amount = url.searchParams.get("amount") || undefined;
          const sender = url.searchParams.get("sender") || undefined;
          const result = await handleIncomingBankNotificationWebhook({ text, title, amount, sender });
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
      }

      // Webhook Penerima Pesan Chat Binance / Verifikasi Wajah Liveness
      if (url.pathname === "/api/webhook/binance-chat" || url.pathname === "/api/webhook/liveness") {
        if (request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          const result = await handleIncomingChatMessageWebhook(body);
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (request.method === "GET") {
          const text = url.searchParams.get("text") || url.searchParams.get("content") || "";
          const orderNo = url.searchParams.get("orderNo") || url.searchParams.get("orderNumber") || undefined;
          const result = await handleIncomingChatMessageWebhook({ text, orderNo });
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
