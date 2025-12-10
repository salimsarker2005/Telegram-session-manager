const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const path = require("path");
const archiver = require("archiver");

const BOT_TOKEN = "8598204496:AAGBC54YH971QBHGKMBiy5U9niKggbEKBCw";
const ADMIN_IDS = [6381012703];
const BASE = path.join(__dirname, "sessionStore");

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

function enc(text) { return Buffer.from(text).toString("base64"); }
function dec(text) { return Buffer.from(text, "base64").toString(); }

// Start command
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, `👋 Welcome ${msg.from.first_name}!\nUse /session to manage sessions.`, {
        reply_markup: { keyboard: [[{ text: "/session" }]], resize_keyboard: true }
    });
});

// Session command
bot.onText(/\/session/, (msg) => {
    bot.sendMessage(msg.chat.id, "Choose an option:", {
        reply_markup: {
            inline_keyboard: [
                [{ text: "📂 All Session", callback_data: "all_sessions" }],
                [{ text: "📁 My Session", callback_data: "my_session" }]
            ]
        }
    });
});

// Callback handler
bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;

    if (query.data === "my_session") {
        bot.sendMessage(chatId, "🔑 Send your token:");
        bot.once("message", async (msg) => {
            const token = msg.text.trim();
            const folder = path.join(BASE, token);
            if (!fs.existsSync(folder)) return bot.sendMessage(chatId, "❌ Invalid token! Folder not found.");
            await sendFolderButtons(chatId, folder, token);
        });
        return;
    }

    if (query.data === "all_sessions") {
        if (!ADMIN_IDS.includes(query.from.id))
            return bot.answerCallbackQuery(query.id, { text: "⛔ You are not an admin.", show_alert: true });

        const folders = fs.readdirSync(BASE).filter(f => fs.statSync(path.join(BASE, f)).isDirectory());
        if (!folders.length) return bot.sendMessage(chatId, "No session folders found.");

        const keyboard = folders.map(f => [{ text: f, callback_data: `open_${enc(f)}` }]);
        return bot.sendMessage(chatId, "Select a session folder:", { reply_markup: { inline_keyboard: keyboard } });
    }

    if (query.data.startsWith("open_")) {
        const token = dec(query.data.replace("open_", ""));
        const folder = path.join(BASE, token);
        if (!fs.existsSync(folder)) return bot.sendMessage(chatId, "❌ Folder not found.");
        await sendFolderButtons(chatId, folder, token);
        return;
    }

    if (query.data.startsWith("zip_")) {
        const token = dec(query.data.replace("zip_", ""));
        const folder = path.join(BASE, token);
        if (!fs.existsSync(folder)) return bot.sendMessage(chatId, "❌ Folder not found.");
        await zipFiles(chatId, folder, token);
        return;
    }

    if (query.data.startsWith("files_")) {
        const token = dec(query.data.replace("files_", ""));
        const folder = path.join(BASE, token);
        if (!fs.existsSync(folder)) return bot.sendMessage(chatId, "❌ Folder not found.");
        await sendFiles(chatId, folder);
        return;
    }
});

// Send folder buttons
async function sendFolderButtons(chatId, folder, token) {
    bot.sendMessage(chatId, `📁 Folder: ${token}`, {
        reply_markup: {
            inline_keyboard: [
                [{ text: "📦 ZIP All", callback_data: `zip_${enc(token)}` }],
                [{ text: "📄 View Files", callback_data: `files_${enc(token)}` }]
            ]
        }
    });
}

// Send files
async function sendFiles(chatId, folder) {
    const files = fs.readdirSync(folder).filter(f => f.endsWith(".txt"));
    if (!files.length) return bot.sendMessage(chatId, "No session files.");
    
    for (const file of files) {
        await bot.sendDocument(chatId, path.join(folder, file));
        await new Promise(r => setTimeout(r, 500));
    }
}

// Zip files
async function zipFiles(chatId, folder, token) {
    const files = fs.readdirSync(folder).filter(f => f.endsWith(".txt"));
    if (!files.length) return bot.sendMessage(chatId, "No session files to zip.");
    
    const zipPath = path.join(folder, `${token}_${Date.now()}.zip`);
    
    await new Promise(resolve => {
        const output = fs.createWriteStream(zipPath);
        const archive = archiver("zip");
        archive.pipe(output);
        files.forEach(f => archive.file(path.join(folder, f), { name: f }));
        archive.finalize();
        output.on("close", resolve);
    });
    
    await bot.sendDocument(chatId, zipPath);
    fs.unlinkSync(zipPath);
}

console.log("✅ Telegram Bot is running...");
