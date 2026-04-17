const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const cheerio = require('cheerio');
const { Octokit } = require('@octokit/rest');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const FormData = require("form-data");
const os = require('os');

// 'baileys' වෙනුවට '@whiskeysockets/baileys' නිවැරදිව භාවිත කර ඇත
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    getContentType,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    downloadContentFromMessage,
    proto,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    S_WHATSAPP_NET
} = require('@whiskeysockets/baileys');

const app = express();
const port = process.env.PORT || 8080;

const config = {
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_RECORDING: 'true',
    AUTO_LIKE_EMOJI: ['💋', '🍬', '💗', '🎈', '🎉', '🥳', '❤️', '🧫'],
    PREFIX: '.',
    BOT_NAME: 'HASHU-MD',
    MAX_RETRIES: 3,
    GROUP_INVITE_LINK: 'https://chat.whatsapp.com/LEHtkTJK49VJ3qtAUdGDnH',
};

// Railway Health Check & Home Page
async function loadNewsletterJIDsFromRaw() {
    try {
        // ttps error එක මෙහිදී නිවැරදි කර ඇත
        const res = await axios.get('https://raw.githubusercontent.com/hashan000-1/newdatabase/refs/heads/main/newsletter_list.json');
        return Array.isArray(res.data) ? res.data : [];
    } catch (err) {
        console.error('❌ Failed to load newsletter list:', err.message);
        return [];
    }
}

// Pair code ලබාගැනීමේ ප්‍රධාන function එක (මෙතනින් පටන් ගන්න)
async function EmpirePair(number, res) {
    const id = crypto.randomBytes(8).toString('hex').toUpperCase();
    const { state, saveCreds } = await useMultiFileAuthState(`./temp/${id}`);
    
    try {
        let sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: "silent" }),
            browser: Browsers.macOS("Desktop"),
        });

        if (!sock.authState.creds.registered) {
            await delay(1500);
            const code = await sock.requestPairingCode(number.trim());
            if (!res.headersSent) {
                res.send({ code });
            }
        }

        sock.ev.on('creds.update', saveCreds);
        sock.ev.on('connection.update', async (s) => {
            const { connection, lastDisconnect } = s;
            if (connection === "open") {
                await delay(5000);
                // Session ID එක සහ අනෙකුත් දත්ත මෙහිදී handle කළ හැක
                console.log(`✅ Connection Open for: ${number}`);
                await sock.sendMessage(sock.user.id, { text: `*HASHU-MD SESSION CONNECTED*\n\nWelcome to World Best Bot System.` });
                
                // Temp files මකා දැමීම
                await delay(2000);
                fs.removeSync(`./temp/${id}`);
            }
            if (connection === "close") {
                console.log("❌ Connection closed, reconnecting...");
            }
        });

    } catch (err) {
        console.error(err);
        if (!res.headersSent) {
            res.status(500).send({ error: "Internal Server Error" });
        }
    }
}

// Route for Pairing
router.get('/pair', async (req, res) => {
    const number = req.query.number;
    if (!number) return res.status(400).send({ error: "Please provide a phone number" });
    await EmpirePair(number, res);
});

app.use('/', router);

app.listen(port, () => {
    console.log(`🚀 HASHU-MD Server started on port ${port}`);
});

module.exports = router;
