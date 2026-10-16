/** Status bot server untuk dashboard (aman di-import komponen React: modul bot dimuat dinamis). */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSession } from "../auth";
import type { ServerBotStatus } from "./runner";

export type { ServerBotStatus } from "./runner";

export const getServerBotStatus = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ sessionToken: z.string().optional() }).parse(data))
  .handler(async ({ data }): Promise<ServerBotStatus | null> => {
    await requireSession(data.sessionToken);
    if (process.env["SERVER_BOT"] !== "1") return null;
    const { getServerBotStatusInternal } = await import("./runner");
    return getServerBotStatusInternal();
  });
