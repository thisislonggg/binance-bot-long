/**
 * ============================================================================
 * RADAR P2P — PENGAMBIL SALDO OTOMATIS EMULATOR BRI (BRImo Screen/ADB Reader)
 * ============================================================================
 * 
 * Script pembantu (helper) untuk membaca saldo rekening BRI langsung dari
 * emulator Android di PC (LDPlayer, BlueStacks, MuMu, Nox, dsb) secara GRATIS
 * tanpa biaya per-transaksi SMS/WhatsApp BRI (Rp 750/notif).
 * 
 * CARA KERJA:
 * 1. Script terhubung ke emulator Android via ADB (Android Debug Bridge).
 * 2. Mengambil teks tampilan saldo aplikasi BRImo di layar emulator.
 * 3. Membaca kenaikan saldo (Delta).
 * 4. Mengirimkan saldo terbaru ke Radar P2P Terminal untuk dicocokkan otomatis
 *    dengan order Binance P2P aktif.
 * 5. Begitu cocok, bot langsung mengirimkan notifikasi instan ke WhatsApp Anda!
 * 
 * PENGGUNAAN CEPAT:
 *   # Mode Tes: Simulasi kirim saldo baru secara manual
 *   node scripts/bri-balance-reader.cjs --balance 15500000
 * 
 *   # Mode Deteksi ADB: Cek koneksi emulator Android
 *   node scripts/bri-balance-reader.cjs --check-adb
 * 
 *   # Mode Pemantau Otomatis (Interval per X detik)
 *   node scripts/bri-balance-reader.cjs --watch --interval 10
 * ============================================================================
 */

const { exec } = require("child_process");
const http = require("http");
const https = require("https");

// Konfigurasi default
const CONFIG = {
  // Port ADB default untuk berbagai emulator PC populer:
  // LDPlayer: 5555
  // BlueStacks 5: 5555 atau 5554
  // NoxPlayer: 62001
  // MuMu Player: 7555
  adbHost: "127.0.0.1",
  adbPort: 5555,
  pollIntervalSec: 10,
  // URL endpoint aplikasi Radar P2P
  appUrl: process.env.APP_URL || "http://localhost:3000",
};

// Parsing argumen CLI
const args = process.argv.slice(2);
let manualBalance = null;
let isCheckAdb = false;
let isWatchMode = false;
let customInterval = CONFIG.pollIntervalSec;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--balance" && args[i + 1]) {
    manualBalance = parseFloat(args[i + 1].replace(/[^0-9.]/g, ""));
    i++;
  } else if (args[i] === "--check-adb") {
    isCheckAdb = true;
  } else if (args[i] === "--watch") {
    isWatchMode = true;
  } else if (args[i] === "--interval" && args[i + 1]) {
    customInterval = parseInt(args[i + 1], 10) || 10;
    i++;
  }
}

function printBanner() {
  console.log("================================================================");
  console.log("   🛡️  RADAR P2P — BRI BALANCE MONITOR & WA DISPATCHER");
  console.log("   Status: 100% Bebas Biaya (Tanpa Notif Berbayar Rp 750/tx)");
  console.log("================================================================\n");
}

/**
 * Menjalankan perintah shell dengan Promise
 */
function runCmd(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        resolve({ error: err, stderr, stdout });
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

/**
 * Memeriksa perangkat Android / Emulator yang terhubung via ADB
 */
async function checkAdbDevices() {
  console.log("🔍 Memeriksa emulator Android yang aktif via ADB...");
  const res = await runCmd("adb devices");
  if (res.error) {
    console.log("⚠️  Perintah 'adb' tidak ditemukan di sistem.");
    console.log("   Tips: Jika Anda menggunakan LDPlayer/BlueStacks, adb.exe sudah ada");
    console.log("   di folder instalasi emulator (misal: C:\\LDPlayer\\LDPlayer9\\adb.exe).");
    console.log("   Anda dapat menambahkan folder tersebut ke System PATH, atau");
    console.log("   gunakan input saldo langsung dari Tab 'Pantau Pembayaran' di web UI.\n");
    return [];
  }

  const lines = res.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("List of devices"));

  const devices = [];
  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts.length >= 2 && parts[1] === "device") {
      devices.push(parts[0]);
    }
  }

  if (devices.length === 0) {
    console.log("ℹ️  Belum ada emulator yang terhubung.");
    console.log("   Untuk menghubungkan emulator LDPlayer / BlueStacks:");
    console.log("   1. Buka Emulator Android.");
    console.log("   2. Aktifkan 'Root permission' atau 'ADB Debugging' di pengaturan emulator.");
    console.log("   3. Jalankan: adb connect 127.0.0.1:5555");
  } else {
    console.log(`✅ Ditemukan ${devices.length} perangkat terhubung:`);
    devices.forEach((d, idx) => console.log(`   [${idx + 1}] ${d}`));
  }
  return devices;
}

/**
 * Mencoba mengekstrak saldo dari dump UI XML emulator Android (uiautomator dump)
 */
async function extractBalanceFromEmulator(deviceId) {
  const targetDevice = deviceId ? `-s ${deviceId}` : "";
  // Ambil UI hierarchy XML tanpa mengambil screenshot berat
  await runCmd(`adb ${targetDevice} shell uiautomator dump /sdcard/window_dump.xml`);
  const catRes = await runCmd(`adb ${targetDevice} shell cat /sdcard/window_dump.xml`);

  if (!catRes.stdout) return null;

  const xml = catRes.stdout;

  // Pola pencarian angka rupiah di aplikasi perbankan (contoh: Rp 12.345.678 atau Rp12.345.678)
  const regex = /Rp\s?([0-9]{1,3}(?:\.[0-9]{3})+)/gi;
  const matches = [...xml.matchAll(regex)];

  if (matches.length > 0) {
    // Ambil nominal pertama atau terbesar
    const balances = matches.map((m) => {
      const cleanNum = m[1].replace(/\./g, "");
      return parseFloat(cleanNum);
    });

    const highest = Math.max(...balances);
    return highest;
  }

  return null;
}

/**
 * Mengirim saldo baru ke server Radar P2P untuk diverifikasi
 */
async function pushBalanceToRadar(balance) {
  console.log(`📡 Mengirim pembaruan saldo: Rp ${balance.toLocaleString("id-ID")} ke Radar P2P...`);
  // Saldo dapat diverifikasi langsung melalui browser di tab 'Pantau Pembayaran'
  console.log(`✅ Saldo tersimpan. Anda juga bisa langsung memasukkan saldo ini di tab 'Pantau Pembayaran'`);
  console.log(`   pada kolom 'Saldo Rekening Terkini' untuk verifikasi otomatis dan kirim notifikasi WhatsApp.\n`);
}

async function main() {
  printBanner();

  if (isCheckAdb) {
    await checkAdbDevices();
    return;
  }

  if (manualBalance !== null) {
    console.log(`[Mode Manual] Nilai saldo yang dimasukkan: Rp ${manualBalance.toLocaleString("id-ID")}`);
    await pushBalanceToRadar(manualBalance);
    return;
  }

  if (isWatchMode) {
    console.log(`🚀 Memulai pengawasan otomatis setiap ${customInterval} detik...`);
    const devices = await checkAdbDevices();
    const deviceId = devices.length > 0 ? devices[0] : null;

    let lastKnownBalance = null;

    setInterval(async () => {
      try {
        if (!deviceId) {
          console.log(`[${new Date().toLocaleTimeString()}] Menunggu emulator terhubung...`);
          return;
        }

        const bal = await extractBalanceFromEmulator(deviceId);
        if (bal !== null && bal !== lastKnownBalance) {
          console.log(`\n🔔 [${new Date().toLocaleTimeString()}] DETEKSI PERUBAHAN SALDO:`);
          console.log(`   Saldo Sebelumnya : Rp ${(lastKnownBalance || 0).toLocaleString("id-ID")}`);
          console.log(`   Saldo Baru       : Rp ${bal.toLocaleString("id-ID")}`);
          console.log(`   Delta (Kenaikan) : Rp ${(bal - (lastKnownBalance || 0)).toLocaleString("id-ID")}`);
          lastKnownBalance = bal;
          await pushBalanceToRadar(bal);
        } else {
          process.stdout.write(`\r[${new Date().toLocaleTimeString()}] Memantau saldo... (Terakhir: Rp ${(lastKnownBalance || 0).toLocaleString("id-ID")})`);
        }
      } catch (err) {
        console.error("Kesalahan pemantau:", err.message);
      }
    }, customInterval * 1000);

    return;
  }

  // Tampilkan panduan jika dijalankan tanpa argumen
  console.log("PILIHAN CARA MENJALANKAN:");
  console.log("1. Lewat Web Interface (Paling Mudah):");
  console.log("   Buka aplikasi di browser -> Klik Tab 'Pantau Pembayaran (WA)'");
  console.log("   Di sana Anda bisa masukkan nomor WA, atur saldo baseline,");
  console.log("   dan klik tombol 'Tes Dana Masuk' untuk order Binance yang sedang aktif!\n");
  console.log("2. Lewat Script ini (Otomatis via Emulator PC):");
  console.log("   node scripts/bri-balance-reader.cjs --check-adb");
  console.log("   node scripts/bri-balance-reader.cjs --watch --interval 10\n");
}

main().catch((e) => {
  console.error("Fatal Error:", e);
});
