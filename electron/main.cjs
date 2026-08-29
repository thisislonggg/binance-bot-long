const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, shell, globalShortcut } = require("electron");
const path = require("path");
const fs = require("fs");

let mainWindow = null;
let tray = null;

// Read configuration
let config = {
  appName: "Radar P2P Binance",
  version: "1.0.0",
  server: {
    productionUrl: "https://binance-bot-long.vercel.app",
    localDevUrl: "http://localhost:3000",
    useLocalInDev: true,
  },
  window: {
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#0b0e14",
  },
};

try {
  const configPath = path.join(__dirname, "..", "app.config.json");
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, "utf-8");
    config = { ...config, ...JSON.parse(raw) };
  }
} catch (err) {
  console.warn("Could not read app.config.json, using defaults.", err);
}

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

function getTargetUrl() {
  if (process.env.APP_URL) {
    return process.env.APP_URL;
  }
  if (isDev && config.server?.useLocalInDev) {
    return config.server.localDevUrl || "http://localhost:3000";
  }
  return config.server?.productionUrl || "https://binance-bot-long.vercel.app";
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: config.window?.width || 1440,
    height: config.window?.height || 900,
    minWidth: config.window?.minWidth || 1024,
    minHeight: config.window?.minHeight || 700,
    backgroundColor: config.window?.backgroundColor || "#0b0e14",
    title: config.appName || "Radar P2P Binance",
    show: false, // Show when ready to prevent flicker
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: false,
    },
  });

  const targetUrl = getTargetUrl();
  console.log(`[Electron] Loading URL: ${targetUrl}`);

  mainWindow.loadURL(targetUrl).catch((err) => {
    console.error("[Electron] Failed to load URL:", err);
    mainWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(`
        <!DOCTYPE html>
        <html lang="id">
        <head>
          <meta charset="utf-8" />
          <title>${config.appName} - Offline</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              background-color: #0b0e14;
              color: #f1f5f9;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
              text-align: center;
            }
            .card {
              background: #151a23;
              border: 1px solid #232b3b;
              border-radius: 12px;
              padding: 32px;
              max-width: 480px;
              box-shadow: 0 8px 24px rgba(0,0,0,0.5);
            }
            h1 { font-size: 20px; color: #f59e0b; margin-bottom: 12px; }
            p { font-size: 14px; color: #94a3b8; line-height: 1.5; margin-bottom: 24px; }
            .url { background: #0b0e14; padding: 6px 12px; border-radius: 6px; font-family: monospace; color: #38bdf8; word-break: break-all; margin-bottom: 20px; }
            button {
              background: #f59e0b;
              color: #000;
              font-weight: 600;
              border: none;
              padding: 10px 24px;
              border-radius: 8px;
              cursor: pointer;
              font-size: 14px;
              transition: opacity 0.2s;
            }
            button:hover { opacity: 0.9; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Gagal Memuat Aplikasi</h1>
            <p>Tidak dapat terhubung ke server. Pastikan koneksi internet aktif atau server development sedang berjalan.</p>
            <div class="url">${targetUrl}</div>
            <button onclick="location.reload()">Coba Muat Ulang</button>
          </div>
        </body>
        </html>
      `)}`
    );
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    if (isDev) {
      // Buka devtools di mode development jika diperlukan
      // mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  });

  // Handle external links safely in standard browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      // Jika link Binance atau eksternal, buka di browser bawaan OS
      if (!url.includes(new URL(targetUrl).hostname)) {
        shell.openExternal(url);
        return { action: "deny" };
      }
    }
    return { action: "allow" };
  });

  // Build native application menu
  const menuTemplate = [
    {
      label: "Aplikasi",
      submenu: [
        {
          label: "Muat Ulang (Reload)",
          accelerator: "CmdOrCtrl+R",
          click: () => mainWindow.reload(),
        },
        {
          label: "Force Reload",
          accelerator: "CmdOrCtrl+Shift+R",
          click: () => mainWindow.webContents.reloadIgnoringCache(),
        },
        { type: "separator" },
        {
          label: "Buka di Web Browser",
          click: () => shell.openExternal(targetUrl),
        },
        { type: "separator" },
        {
          label: "Keluar",
          accelerator: "CmdOrCtrl+Q",
          click: () => app.quit(),
        },
      ],
    },
    {
      label: "Tampilan",
      submenu: [
        { role: "resetZoom", label: "Ukuran Normal" },
        { role: "zoomIn", label: "Perbesar" },
        { role: "zoomOut", label: "Perkecil" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Layar Penuh" },
        {
          label: "Toggle Developer Tools",
          accelerator: "F12",
          click: () => mainWindow.webContents.toggleDevTools(),
        },
      ],
    },
    {
      label: "Bantuan",
      submenu: [
        {
          label: "Tentang Radar P2P",
          click: () => {
            const { dialog } = require("electron");
            dialog.showMessageBox(mainWindow, {
              type: "info",
              title: "Tentang Aplikasi",
              message: `${config.appName} v${config.version}`,
              detail: "Terminal Merchant Binance USDT/IDR & Arbitrage Scanner.\nDirancang untuk efisiensi transaksi dan pemantauan pasar P2P secara real-time.",
              buttons: ["OK"],
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// IPC Handlers
ipcMain.on("window:minimize", () => mainWindow?.minimize());
ipcMain.on("window:maximize", () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.on("window:close", () => mainWindow?.close());
ipcMain.on("app:reload", () => mainWindow?.reload());

// App lifecycle
app.whenReady().then(() => {
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
