import React, { useState } from "react";

import { Input } from "@/components/ui/input";

/**
 * Parse angka format Indonesia.
 * - Mode IDR (default): "." dan "," dianggap pemisah ribuan → "16.250" = 16250, "1.500.000" = 1500000.
 * - Mode desimal (USDT): "," atau "." dianggap titik desimal → "45,5" = 45.5, "45.123" = 45.123.
 * String kosong = 0. Mengembalikan NaN jika tidak valid.
 */
function parseIdNumber(raw: string, decimal = false): number {
  const s = raw.replace(/rp/gi, "").replace(/[\s_]/g, "");
  if (s === "") return 0;
  if (!decimal) {
    const digits = s.replace(/[.,]/g, "");
    return /^\d+$/.test(digits) ? Number(digits) : NaN;
  }
  const normalized = s.replace(/,/g, ".");
  return /^\d*\.?\d*$/.test(normalized) && normalized !== "." ? Number(normalized) : NaN;
}

type CommitNumberInputProps = React.ComponentProps<typeof Input> & {
  /** true untuk nilai USDT (boleh desimal); default IDR bulat. */
  decimal?: boolean;
};

/**
 * Pengganti <Input type="number"> untuk config bot: ketikan hanya disimpan sebagai draft lokal,
 * dan baru diteruskan ke onChange saat blur / Enter (Escape membatalkan). Ini mencegah nilai
 * setengah jadi (mis. "17" saat mengetik "17500") ikut terpasang ke iklan Binance oleh auto-push.
 * onChange menerima event dengan target.value berupa angka yang sudah dinormalisasi.
 */
export function CommitNumberInput({
  value,
  onChange,
  onBlur,
  onKeyDown,
  decimal = false,
  type: _type,
  ...rest
}: CommitNumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const n = parseIdNumber(draft, decimal);
    setDraft(null);
    if (!Number.isFinite(n) || n < 0) return; // input tidak valid: kembali ke nilai tersimpan
    const normalized = String(n);
    onChange?.({
      target: { value: normalized },
      currentTarget: { value: normalized },
    } as React.ChangeEvent<HTMLInputElement>);
  };

  return (
    <Input
      {...rest}
      type="text"
      inputMode={decimal ? "decimal" : "numeric"}
      value={draft ?? value ?? ""}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        commit();
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          commit();
        } else if (e.key === "Escape") {
          setDraft(null);
        }
        onKeyDown?.(e);
      }}
    />
  );
}
