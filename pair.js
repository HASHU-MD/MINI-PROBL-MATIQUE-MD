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
const { sms, downloadMediaMessage } = require("./msg");
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
} = require('baileys');

const config = {
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_RECORDING: 'true',
    AUTO_LIKE_EMOJI: ['💋', '🍬', '🫆', '💗', '🎈', '🎉', '🥳', '❤️', '🧫', '🐭'],
    PREFIX: '.',
	BOT_NAME: 'DEATH-NOTE-MD',
    MAX_RETRIES: 3,
    GROUP_INVITE_LINK: 'https://chat.whatsapp.com/LEHtkTJK49VJ3qtAUdGDnH?mode=wwt',
    ADMIN_LIST_PATH: './admin.json',
    RCD_IMAGE_PATH: './IMG-20251024-WA0009.jpg',
    NEWSLETTER_JID: '120363395674230271@newsletter',
    NEWSLETTER_MESSAGE_ID: '428',
    OTP_EXPIRY: 300000,
    OWNER_NUMBER: '94706042889',
    CHANNEL_LINK: 'https://whatsapp.com/channel/0029VazhnLzK0IBdwXG4152o'
};

const octokit = new Octokit({ auth: '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' });// ඔයා 𝚐𝚒𝚝𝚑𝚞𝚋 𝚝𝚘𝚔𝚎𝚗 එකක් අරන් ඒක දාන්න
const owner = 'HASHU-MD';//𝚐𝚒𝚝𝚑𝚞𝚋 𝙰𝙲𝙲𝙾𝚄𝙽𝚃 එකේ 𝚞𝚜𝚎𝚗𝚊𝚖𝚎 දාන්න 
const repo = 'HASHUU';//𝚐𝚒𝚝𝚑𝚞𝚋 𝚛𝚎𝚙𝚘 එකක් හදලා ඒකේ නම දාන්න

const activeSockets = new Map();
const socketCreationTime = new Map();
const SESSION_BASE_PATH = './session';
const NUMBER_LIST_PATH = './numbers.json';
const otpStore = new Map();

if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });
}

function loadAdmins() {
    try {
        if (fs.existsSync(config.ADMIN_LIST_PATH)) {
            return JSON.parse(fs.readFileSync(config.ADMIN_LIST_PATH, 'utf8'));
        }
        return [];
    } catch (error) {
        console.error('Failed to load admin list:', error);
        return [];
    }
}

function formatMessage(title, content, footer) {
    return `*${title}*\n\n${content}\n\n> *${footer}*`;
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function getSriLankaTimestamp() {
    return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss');
}
// CREATE BY SULA MD
async function cleanDuplicateFiles(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file => 
            file.name.startsWith(`empire_${sanitizedNumber}_`) && file.name.endsWith('.json')
        ).sort((a, b) => {
            const timeA = parseInt(a.name.match(/empire_\d+_(\d+)\.json/)?.[1] || 0);
            const timeB = parseInt(b.name.match(/empire_\d+_(\d+)\.json/)?.[1] || 0);
            return timeB - timeA;
        });

        const configFiles = data.filter(file => 
            file.name === `config_${sanitizedNumber}.json`
        );

        if (sessionFiles.length > 1) {
            for (let i = 1; i < sessionFiles.length; i++) {
                await octokit.repos.deleteFile({
                    owner,
                    repo,
                    path: `session/${sessionFiles[i].name}`,
                    message: `Delete duplicate session file for ${sanitizedNumber}`,
                    sha: sessionFiles[i].sha
                });
                console.log(`Deleted duplicate session file: ${sessionFiles[i].name}`);
            }
        }

        if (configFiles.length > 0) {
            console.log(`Config file for ${sanitizedNumber} already exists`);
        }
    } catch (error) {
        console.error(`Failed to clean duplicate files for ${number}:`, error);
    }
}

async function joinGroup(socket) {
    let retries = config.MAX_RETRIES;
    const inviteCodeMatch = config.GROUP_INVITE_LINK.match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
    if (!inviteCodeMatch) {
        console.error('Invalid group invite link format');
        return { status: 'failed', error: 'Invalid group invite link' };
    }
    const inviteCode = inviteCodeMatch[1];

    while (retries > 0) {
        try {
            const response = await socket.groupAcceptInvite(inviteCode);
            if (response?.gid) {
                console.log(`Successfully joined group with ID: ${response.gid}`);
                return { status: 'success', gid: response.gid };
            }
            throw new Error('No group ID in response');
        } catch (error) {
            retries--;
            let errorMessage = error.message || 'Unknown error';
            if (error.message.includes('not-authorized')) {
                errorMessage = 'Bot is not authorized to join (possibly banned)';
            } else if (error.message.includes('conflict')) {
                errorMessage = 'Bot is already a member of the group';
            } else if (error.message.includes('gone')) {
                errorMessage = 'Group invite link is invalid or expired';
            }
            console.warn(`Failed to join group, retries left: ${retries}`, errorMessage);
            if (retries === 0) {
                return { status: 'failed', error: errorMessage };
            }
            await delay(2000 * (config.MAX_RETRIES - retries));
        }
    }
    return { status: 'failed', error: 'Max retries reached' };
}

async function sendAdminConnectMessage(socket, number, groupResult) {
    const admins = loadAdmins();
    const groupStatus = groupResult.status === 'success'
        ? `Joined (ID: ${groupResult.gid})`
        : `Failed to join group: ${groupResult.error}`;
    const caption = formatMessage(
        '👻 𝐂𝙾𝙽𝙽𝙴𝙲𝚃 DEATH-NOTE-MD 𝐅𝚁𝙴𝙴 𝐁𝙾𝚃 👻',
        `📞 Number: ${number}\n🩵 Status: Connected`,
        'POWERED BY DEATH-NOTE-MD MINI ✨️'
    );

    for (const admin of admins) {
        try {
            await socket.sendMessage(
                `${admin}@s.whatsapp.net`,
                {
                    image: { url: config.RCD_IMAGE_PATH },
                    caption
                }
            );
        } catch (error) {
            console.error(`Failed to send connect message to admin ${admin}:`, error);
        }
    }
}

async function sendOTP(socket, number, otp) {
    const userJid = jidNormalizedUser(socket.user.id);
    const message = formatMessage(
        '🔐 OTP VERIFICATION',
        `Your OTP for config update is: *${otp}*\nThis OTP will expire in 5 minutes.`,
        'POWERED BY DEATH-NOTE-MD MINI ✨️'
    );

    try {
        await socket.sendMessage(userJid, { text: message });
        console.log(`OTP ${otp} sent to ${number}`);
    } catch (error) {
        console.error(`Failed to send OTP to ${number}:`, error);
        throw error;
    }
}

function setupNewsletterHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key) return;

        const allNewsletterJIDs = await loadNewsletterJIDsFromRaw();
        const jid = message.key.remoteJid;

        if (!allNewsletterJIDs.includes(jid)) return;

        try {
            const emojis = ['🩵','🔥','😀','👍','🐭'];
            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
            const messageId = message.newsletterServerId;

            if (!messageId) {
                console.warn('No newsletterServerId found in message:', message);
                return;
            }

            let retries = 3;
            while (retries-- > 0) {
                try {
                    await socket.newsletterReactMessage(jid, messageId.toString(), randomEmoji);
                    console.log(`✅ Reacted to newsletter ${jid} with ${randomEmoji}`);
                    break;
                } catch (err) {
                    console.warn(`❌ Reaction attempt failed (${3 - retries}/3):`, err.message);
                    await delay(1500);
                }
            }
        } catch (error) {
            console.error('⚠️ Newsletter reaction handler failed:', error.message);
        }
    });
}

async function setupStatusHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant || message.key.remoteJid === config.NEWSLETTER_JID) return;

        try {
            if (config.AUTO_RECORDING === 'true' && message.key.remoteJid) {
                await socket.sendPresenceUpdate("recording", message.key.remoteJid);
            }

            if (config.AUTO_VIEW_STATUS === 'true') {
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.readMessages([message.key]);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to read status, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }

            if (config.AUTO_LIKE_STATUS === 'true') {
                const randomEmoji = config.AUTO_LIKE_EMOJI[Math.floor(Math.random() * config.AUTO_LIKE_EMOJI.length)];
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.sendMessage(
                            message.key.remoteJid,
                            { react: { text: randomEmoji, key: message.key } },
                            { statusJidList: [message.key.participant] }
                        );
                        console.log(`Reacted to status with ${randomEmoji}`);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to react to status, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }
        } catch (error) {
            console.error('Status handler error:', error);
        }
    });
}

async function handleMessageRevocation(socket, number) {
    socket.ev.on('messages.delete', async ({ keys }) => {
        if (!keys || keys.length === 0) return;

        const messageKey = keys[0];
        const userJid = jidNormalizedUser(socket.user.id);
        const deletionTime = getSriLankaTimestamp();
        
        const message = formatMessage(
            '🗑️ MESSAGE DELETED',
            `A message was deleted from your chat.\n📋 From: ${messageKey.remoteJid}\n🍁 Deletion Time: ${deletionTime}`,
            ''
        );

        try {
            await socket.sendMessage(userJid, {
                image: { url: config.RCD_IMAGE_PATH },
                caption: message
            });
            console.log(`Notified ${number} about message deletion: ${messageKey.id}`);
        } catch (error) {
            console.error('Failed to send deletion notification:', error);
        }
    });
}

async function resize(image, width, height) {
    let oyy = await Jimp.read(image);
    let kiyomasa = await oyy.resize(width, height).getBufferAsync(Jimp.MIME_JPEG);
    return kiyomasa;
}

function capital(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

const createSerial = (size) => {
    return crypto.randomBytes(size).toString('hex').slice(0, size);
}
async function oneViewmeg(socket, isOwner, msg ,sender) {
    if (isOwner) {  
    try {
    const akuru = sender
    const quot = msg
    if (quot) {
        if (quot.imageMessage?.viewOnce) {
            console.log("hi");
            let cap = quot.imageMessage?.caption || "";
            let anu = await socket.downloadAndSaveMediaMessage(quot.imageMessage);
            await socket.sendMessage(akuru, { image: { url: anu }, caption: cap });
        } else if (quot.videoMessage?.viewOnce) {
            console.log("hi");
            let cap = quot.videoMessage?.caption || "";
            let anu = await socket.downloadAndSaveMediaMessage(quot.videoMessage);
             await socket.sendMessage(akuru, { video: { url: anu }, caption: cap });
        } else if (quot.audioMessage?.viewOnce) {
            console.log("hi");
            let cap = quot.audioMessage?.caption || "";
            let anu = await socke.downloadAndSaveMediaMessage(quot.audioMessage);
             await socket.sendMessage(akuru, { audio: { url: anu }, caption: cap });
        } else if (quot.viewOnceMessageV2?.message?.imageMessage){
        
            let cap = quot.viewOnceMessageV2?.message?.imageMessage?.caption || "";
            let anu = await socket.downloadAndSaveMediaMessage(quot.viewOnceMessageV2.message.imageMessage);
             await socket.sendMessage(akuru, { image: { url: anu }, caption: cap });
            
        } else if (quot.viewOnceMessageV2?.message?.videoMessage){
        
            let cap = quot.viewOnceMessageV2?.message?.videoMessage?.caption || "";
            let anu = await socket.downloadAndSaveMediaMessage(quot.viewOnceMessageV2.message.videoMessage);
            await socket.sendMessage(akuru, { video: { url: anu }, caption: cap });

        } else if (quot.viewOnceMessageV2Extension?.message?.audioMessage){
        
            let cap = quot.viewOnceMessageV2Extension?.message?.audioMessage?.caption || "";
            let anu = await socket.downloadAndSaveMediaMessage(quot.viewOnceMessageV2Extension.message.audioMessage);
            await socket.sendMessage(akuru, { audio: { url: anu }, caption: cap });
        }
        }        
        } catch (error) {
      }
    }

}

function setupCommandHandlers(socket, number) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

const type = getContentType(msg.message);
    if (!msg.message) return	
  msg.message = (getContentType(msg.message) === 'ephemeralMessage') ? msg.message.ephemeralMessage.message : msg.message
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
	const m = sms(socket, msg);
	const quoted =
        type == "extendedTextMessage" &&
        msg.message.extendedTextMessage.contextInfo != null
          ? msg.message.extendedTextMessage.contextInfo.quotedMessage || []
          : []
        const body = (type === 'conversation') ? msg.message.conversation 
    : msg.message?.extendedTextMessage?.contextInfo?.hasOwnProperty('quotedMessage') 
        ? msg.message.extendedTextMessage.text 
    : (type == 'interactiveResponseMessage') 
        ? msg.message.interactiveResponseMessage?.nativeFlowResponseMessage 
            && JSON.parse(msg.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson)?.id 
    : (type == 'templateButtonReplyMessage') 
        ? msg.message.templateButtonReplyMessage?.selectedId 
    : (type === 'extendedTextMessage') 
        ? msg.message.extendedTextMessage.text 
    : (type == 'imageMessage') && msg.message.imageMessage.caption 
        ? msg.message.imageMessage.caption 
    : (type == 'videoMessage') && msg.message.videoMessage.caption 
        ? msg.message.videoMessage.caption 
    : (type == 'buttonsResponseMessage') 
        ? msg.message.buttonsResponseMessage?.selectedButtonId 
    : (type == 'listResponseMessage') 
        ? msg.message.listResponseMessage?.singleSelectReply?.selectedRowId 
    : (type == 'messageContextInfo') 
        ? (msg.message.buttonsResponseMessage?.selectedButtonId 
            || msg.message.listResponseMessage?.singleSelectReply?.selectedRowId 
            || msg.text) 
    : (type === 'viewOnceMessage') 
        ? msg.message[type]?.message[getContentType(msg.message[type].message)] 
    : (type === "viewOnceMessageV2") 
        ? (msg.msg.message.imageMessage?.caption || msg.msg.message.videoMessage?.caption || "") 
    : ''; //𝚂𝚄𝙻𝙰 𝙼𝙳 𝙵𝚁𝙴𝙴 𝙼𝙸𝙽𝙸 𝙱𝙰𝚂𝙴
	 	let sender = msg.key.remoteJid;
	  const nowsender = msg.key.fromMe ? (socket.user.id.split(':')[0] + '@s.whatsapp.net' || socket.user.id) : (msg.key.participant || msg.key.remoteJid)
          const senderNumber = nowsender.split('@')[0]
          const developers = `${config.OWNER_NUMBER}`;
          const botNumber = socket.user.id.split(':')[0]
          const isbot = botNumber.includes(senderNumber)
          const isOwner = isbot ? isbot : developers.includes(senderNumber)
          var prefix = config.PREFIX
	  var isCmd = body.startsWith(prefix)
    	  const from = msg.key.remoteJid;
          const isGroup = from.endsWith("@g.us")
	      const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : '.';
          var args = body.trim().split(/ +/).slice(1)
socket.downloadAndSaveMediaMessage = async(message, filename, attachExtension = true) => {
                let quoted = message.msg ? message.msg : message
                let mime = (message.msg || message).mimetype || ''
                let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0]
                const stream = await downloadContentFromMessage(quoted, messageType)
                let buffer = Buffer.from([])
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk])
                }
                let type = await FileType.fromBuffer(buffer)
                trueFileName = attachExtension ? (filename + '.' + type.ext) : filename
                await fs.writeFileSync(trueFileName, buffer)
                return trueFileName
}
        if (!command) return;
        
        let pinterestCache = {}; //

        try {
            switch (command) {
       case 'alive': {
    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);

    const captionText = `
╭────◉◉◉────៚
⏰ Bot Uptime: ${hours}h ${minutes}m ${seconds}s
🟢 Active session: ${activeSockets.size}
╰────◉◉◉────៚

🔢 Your Number: ${number}

*▫️ Our Main Channel 🌐*

> https://whatsapp.com/channel/0029VazhnLzK0IBdwXG4152o
`;

    const templateButtons = [
        {
            buttonId: `${config.PREFIX}menu`,
            buttonText: { displayText: 'MENU' },
            type: 1,
        },
        {
            buttonId: `${config.PREFIX}owner`,
            buttonText: { displayText: 'OWNER' },
            type: 1,
        },
        {
            buttonId: 'action',
            buttonText: {
                displayText: '📂 Menu Options'
            },
            type: 4,
            nativeFlowInfo: {
                name: 'single_select',
                paramsJson: JSON.stringify({
                    title: 'Click Here ❏',
                    sections: [
                        {
                            title: `DEATH-NOTE-MD`,
                            highlight_label: '',
                            rows: [
                                {
                                    title: 'MENU 📌',
                                    description: 'CRASH DELTA TM',
                                    id: `${config.PREFIX}menu`,
                                },
                                {
                                    title: 'OWNER 📌',
                                    description: 'CRASH DELTA TM',
                                    id: `${config.PREFIX}owner`,
                                },
                            ],
                        },
                    ],
                }),
            },
        }
    ];

    await socket.sendMessage(m.chat, {
        buttons: templateButtons,
        headerType: 1,
        viewOnce: true,
        image: { url: "https://files.catbox.moe/l06cb8.jpg" },
        caption: `*POWERED BY CRASH DELTA TEAM ⚡*\n\n${captionText}`,
    }, { quoted: msg });

    break;
}
 case 'menu': {
			const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);

    
    const captionText = `
*✨️ DEATH-NOTE-MD MINI BOT ✨️*

║▻ 𝙏𝙝𝙞𝙨 𝙞𝙨 𝙢𝙮 𝙢𝙚𝙣𝙪 𝙡𝙞𝙨𝙩 ◅║

╭────◅●👾●▻────
⭕ ʙᴏᴛ ᴜᴘ ᴛɪᴍᴇ ➟ ${hours}h ${minutes}m ${seconds}s
⭕ ᴀᴄᴛɪᴠᴇ ᴄᴏᴜɴᴛ ➟ ${activeSockets.size}
⭕ ᴍɪɴɪ ᴠᴇʀꜱɪᴏɴ ➟ 1.0.0 ᴠ
⭕ ᴅᴇᴘʟᴏʏ ᴘʟᴀᴛꜰʀᴏᴍ ➟ Heroku
⭕ ʙᴏᴛ ᴏᴡɴᴇʀ ➟ hashu
╰────◅●👾●▻────➢

*🛡️ DEATH-NOTE-MD MINI BOT COMMANDS*

*🔧 USE THIS COMMANDS ✨️*

╭─「 *DOWNLOAD COMMANDS* 」
│📂 _.song_
│📂 _.video_
│📂 _.fb_
│📂 _.tiktok_
│📂 _.xvideo_
│📂 _.apk_
│📂 _.yt_
╰──────────✿✿►
‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎‎
  
╭─「 *GENERAL COMMANDS* 」
│📂 _.alive_
│📂 _.menu_
│📂 _.pair_
│📂 _.ping_
│📂 _.active_
│📂 _.owner_
╰──────────✿✿►
  
╭─「 *TOOLS COMMANDS* 」
│📂 _.about_
│📂 _.fancy_
│📂 _.movie_
│📂 _.bomb_
│📂 _.chr_
│📂 _.fc_
╰──────────✿✿►
  
╭─「 *AI COMMANDS* 」
│📂 _.ai_
│📂 _.gpt_
│📂 _.aiimg_
│📂 _.bot_
╰──────────✿✿►

╭─「 *NEWS COMMANDS* 」
│📂 _.news_
╰──────────✿✿►

╭─「 *18+ COMMANDS* 」
│📂 _.xvideo_
│📂 _.xnxxdl_
│📂 _.xnxxdlres_
╰──────────✿✿►

  
╭─「 *OWNER COMMANDS* 」
│📂 _.set_
│📂 _.settings_
│📂 _.csong_
│📂 _.vv_
╰──────────✿✿►
  
> *DEATH-NOTE-MD LITE*  🔰

*⚖️ LINK DEVICE ONLY ✅*
*⚖️ FREE CONNECT ✅*
*⚖️ ALL DOWNLOAD ✅*

> POWERED BY HASHU TECH  🔥`;

    const templateButtons = [
        {
            buttonId: `.alive`,
            buttonText: { displayText: '❲ ALIVE 🪄 ❳ ' },
            type: 1,
        },
        {
            buttonId: `.owner`,
            buttonText: { displayText: '❲ OWNER 🫟❳' },
            type: 1,
        },
                {
            buttonId: 'action',
            buttonText: {
                displayText: ' ◅ ❤️👨‍🔧ᴍᴇɴᴜ ᴏᴘᴄᴛɪᴏɴꜱ ▻'
            },
            type: 4,
            nativeFlowInfo: {
                name: 'single_select',
                paramsJson: JSON.stringify({
                    title: '𝙏𝘼𝘽 𝙎𝙀𝘾𝙏𝙄𝙊𝙉❕',
                    sections: [
                        {
                            title: `DEATH-NOTE-MD ⚡`,
                            highlight_label: '',
                            rows: [
                                {
                                    title: '❲ 𝘊𝘏𝘌𝘊𝘒 𝘉𝘖𝘛 𝘚𝘛𝘈𝘛𝘜𝘚 🫟 ❳',
                                    description: 'POWERED BY HASHU 🔥',
                                    id: `.alive`,
                                },
                                {
                                    title: ' ❲ 𝘔𝘈𝘐𝘕 𝘔𝘌𝘕𝘜 𝘓𝘐𝘚𝘛 🤍 ❳',
                                    description: 'POWERED BY HASHU  🔥',
                                    id: `.listmenu`,
                                },
                            ],
                        },
                    ],
                }),
            },
        }
    ];

    await socket.sendMessage(m.chat, {
        buttons: templateButtons,
        headerType: 1,
        viewOnce: true,
        image: { url: "https://i.ibb.co/Kjq97rcG/3575.jpg" },
        caption: `POWERED BY HASHU TECH \n\n${captionText}`,
    }, { quoted: msg });

    break;
}          

case 'settings':
case 'setting': {
    const adminNumbers = [
        '94704198014', // bot owner
        // '94712345678', // admin
    ];
    const botNumber = socket.user.id.split(':')[0];
    if (![botNumber, ...adminNumbers].includes(senderNumber)) {
        return await socket.sendMessage(sender, { text: '❌ Only the bot or admins can use this command.' }, { quoted: msg });
    }

    // Load user config (or default)
    const userConfig = await loadUserConfig(sanitizedNumber);

    // Only show these keys, in this order:
    const keys = [
		'PREFIX',
        'AUTO_VIEW_STATUS',
        'AUTO_LIKE_STATUS',
        'AUTO_RECORDING',
        
    ];

    // Emoji map for each setting
    const emojiMap = {
		PREFIX: '🔑',
        AUTO_VIEW_STATUS: '👀',
        AUTO_LIKE_STATUS: '❤️',
        AUTO_RECORDING: '🎙️',
        AUTO_LIKE_EMOJI: '😻'
        
    };

    // Helper to format ON/OFF
    const onOff = v => v === true || v === 'true' ? '🟢 ON' : '🔴 OFF';

    // Build the settings text
    let settingsText = `╭━━━[ *🛠️ Your Settings* ]━━━⬣\n`;

    for (const key of keys) {
        let value = userConfig[key];
        if (key === 'AUTO_LIKE_EMOJI' && Array.isArray(value)) {
            settingsText += `┃ ${emojiMap[key]} ${key}: ${value.join(' ')}\n`;
        } else if (typeof value === 'boolean' || value === 'true' || value === 'false') {
            settingsText += `┃ ${emojiMap[key]} ${key}: ${onOff(value)}\n`;
        } else {
            settingsText += `┃ ${emojiMap[key]} ${key}: ${value}\n`;
        }
    }

    settingsText += `╰━━━━━━━━━━━━━━━━━━⬣\n`;
	settingsText += `Usage: .set <key> <value>\nExample: .set AUTO_LIKE_STATUS true\n`;
	settingsText += `> *𝛲𝛩𝑊𝛯𝑅𝐷 𝐵𝑌 DEATH-NOTE-MD*`;

    await socket.sendMessage(m.chat, { react: { text: '⚙️', key: msg.key } });
    await socket.sendMessage(sender, { text: settingsText }, { quoted: msg });
    break;
}
case 'set': {
    // Only allow the bot number to edit configs
    const adminNumbers = [
      '94704198014', // bot owner
      //'94712345678', // admin
    ];
    const botNumber = socket.user.id.split(':')[0];
    if (![botNumber, ...adminNumbers].includes(senderNumber)) {
        return await socket.sendMessage(sender, { text: '❌ Only the bot or admins can use this command.' }, { quoted: msg });
    }
    if (args.length < 2) {
        return await socket.sendMessage(sender, { text: 'Usage: .set <key> <value>\nExample: .set AUTO_LIKE_STATUS true' }, { quoted: msg });
    }
    const key = args[0].toUpperCase();
    let value = args.slice(1).join(' ');

    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (!isNaN(value)) value = Number(value);

    let userConfig = await loadUserConfig(sanitizedNumber);

    if (!(key in defaultUserConfig)) {
        return await socket.sendMessage(sender, { text: `Unknown setting: ${key}` }, { quoted: msg });
    }

    userConfig[key] = value;
    await updateUserConfig(sanitizedNumber, userConfig);
 await socket.sendMessage(m.chat, { react: { text: '✅', key: msg.key } });
    await socket.sendMessage(sender, { text: `✅ Setting *${key}* updated to *${value}*.` }, { quoted: msg });
    break;
}

case 'ping':
        await socket.sendMessage(sender, { react: { text: "🚀", key: msg.key } });

                    var inital = new Date().getTime();
                    const { key } = await socket.sendMessage(sender, { text: '```Ping ⏳```' });
                    var final = new Date().getTime();
                    await socket.sendMessage(sender, { text: '*📍 Pong*  *' + (final - inital) + ' ms* ', edit: key });

                break;
		        case 'owner': {
    const ownerNumber = '+94716042889';
    const ownerName = 'Mr Hashuwh';
    const organization = '*HASHAN-MD* WHATSAPP BOT DEVALOPER 🍬';

    const vcard = 'BEGIN:VCARD\n' +
                  'VERSION:3.0\n' +
                  `FN:${ownerName}\n` +
                  `ORG:${organization};\n` +
                  `TEL;type=CELL;type=VOICE;waid=${ownerNumber.replace('+', '')}:${ownerNumber}\n` +
                  'END:VCARD';

    try {
        // Send vCard contact
        const sent = await socket.sendMessage(from, {
            contacts: {
                displayName: ownerName,
                contacts: [{ vcard }]
            }
        });

        // Then send message with reference
        await socket.sendMessage(from, {
            text: `*HASHAN-MD OWNER*\n\n👤 Name: ${ownerName}\n📞 Number: ${ownerNumber}\n\n> POWERED BY DEATH-NOTE-MD MINI`,
            contextInfo: {
                mentionedJid: [`${ownerNumber.replace('+', '')}@s.whatsapp.net`],
                quotedMessageId: sent.key.id
            }
        }, { quoted: msg });

    } catch (err) {
        console.error('❌ Owner command error:', err.message);
        await socket.sendMessage(from, {
            text: '❌ Error sending owner contact.'
        }, { quoted: msg });
    }

    break;
}
              case 'aiimg': {
  const axios = require('axios');

  const q =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption || '';

  const prompt = q.trim();

  if (!prompt) {
    return await socket.sendMessage(sender, {
      text: '🎨 *Please provide a prompt to generate an AI image.*'
    });
  }

  try {
    // Notify that image is being generated
    await socket.sendMessage(sender, {
      text: '🧠 *Creating your AI image...*',
    });

    // Build API URL
    const apiUrl = `https://api.siputzx.my.id/api/ai/flux?prompt=${encodeURIComponent(prompt)}`;

    // Call the AI API
    const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });

    // Validate API response
    if (!response || !response.data) {
      return await socket.sendMessage(sender, {
        text: '❌ *API did not return a valid image. Please try again later.*'
      });
    }

    // Convert the binary image to buffer
    const imageBuffer = Buffer.from(response.data, 'binary');

    // Send the image
    await socket.sendMessage(sender, {
      image: imageBuffer,
      caption: `🧠 *${botName} AI IMAGE*\n\n📌 Prompt: ${prompt}`
    }, { quoted: msg });

  } catch (err) {
    console.error('AI Image Error:', err);

    await socket.sendMessage(sender, {
      text: `❗ *An error occurred:* ${err.response?.data?.message || err.message || 'Unknown error'}`
    });
  }

  break;
}
              
case 'song': {
    
    await socket.sendMessage(sender, { react: { text: '🎧', key: msg.key } });
    
    function replaceYouTubeID(url) {
    const regex = /(?:youtube\.com\/(?:.*v=|.*\/)|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
}
    
    const q = args.join(" ");
    if (!args[0]) {
        return await socket.sendMessage(from, {
      text: 'Please enter you tube song name or link !!'
    }, { quoted: msg });
    }
    
    try {
        let id = q.startsWith("https://") ? replaceYouTubeID(q) : null;
        
        if (!id) {
            const searchResults = await dy_scrap.ytsearch(q);
            
            /*const ytsApiid = await fetch(`https://tharuzz-ofc-apis.vercel.app/api/search/ytsearch?query=${q}`);
            const respId = await ytsApiid.json();*/
           if(!searchResults?.results?.length) return await socket.sendMessage(from, {
             text: '*📛 Please enter valid you tube song name or url.*'
                 });
                }
                
                const data = await dy_scrap.ytsearch(`https://youtube.com/watch?v=${id}`);
                
                if(!data?.results?.length) return await socket.sendMessage(from, {
             text: '*📛 Please enter valid you tube song name or url.*'
                 });
        
                const { url, title, image, timestamp, ago, views, author } = data.results[0];
                
                const caption = `*🎧 \`DEATH-NOTE-MD SONG DOWNLOADER\`*\n\n` +
		  `*┏━━━━━━━━━━━━━━━*\n` +
	      `*┃ 📌 \`тιтℓє:\` ${title || "No info"}*\n` +
	      `*┃ ⏰ \`∂υяαтιση:\` ${timestamp || "No info"}*\n` +
	      `*┃ 📅 \`яєℓєαѕє∂ ∂αтє:\` ${ago || "No info"}*\n` +
	      `*┃ 👀 \`νιєωѕ:\` ${views || "No info"}*\n` +
	      `*┃ 👤 \`αυтнσя:\` ${author || "No info"}*\n` +
	      `*┃ 📎 \`υяℓ:\` ~${url || "No info"}~*\n` +
		  `*┗━━━━━━━━━━━━━━━━━━*\n\n` + config.THARUZZ_FOOTER
		  
		  const templateButtons = [
      {
        buttonId: `${config.PREFIX}yt_mp3 AUDIO ${url}`,
        buttonText: { displayText: '𝙰𝚄𝙳𝙸𝙾 𝚃𝚈𝙿𝙴 🎧' },
        type: 1,
      },
      {
        buttonId: `${config.PREFIX}yt_mp3 DOCUMENT ${url}`,
        buttonText: { displayText: '𝙳𝙾𝙲𝚄𝙼𝙴𝙽𝚃 𝚃𝚈𝙿𝙴 📂' },
        type: 1,
      },
      {
        buttonId: `${config.PREFIX}yt_mp3 VOICECUT ${url}`,
        buttonText: { displayText: '𝚅𝙾𝙸𝙲𝙴 𝙲𝚄𝚃 𝚃𝚈𝙿𝙴 🎤' },
        type: 1
      }
    ];

		  await socket.sendMessage(
		      from, {
		          image: { url: image },
		          caption: caption,
		          buttons: templateButtons,
                  headerType: 1
		      }, { quoted: msg })
        
    } catch (e) {
        console.log("❌ Song command error: " + e)
    }
    
    break;
};

case 'yt_mp3': {
await socket.sendMessage(sender, { react: { text: '📥', key: msg.key } });
    const q = args.join(" ");
    const mediatype = q.split(" ")[0];
    const meidaLink = q.split(" ")[1];
    
    try {
        const yt_mp3_Api = await fetch(`https://tharuzz-ofc-api-v2.vercel.app/api/download/ytmp3?url=${meidaLink}&quality=128`);
        const yt_mp3_Api_Call = await yt_mp3_Api.json();
        const downloadUrl = yt_mp3_Api_Call?.result?.download?.url;
        
        if ( mediatype === "AUDIO" ) {
            await socket.sendMessage(
                from, {
                    audio: { url: downloadUrl },
                    mimetype: "audio/mpeg"
                }, { quoted: msg }
            )
        };
        
        if ( mediatype === "DOCUMENT" ) {
            await socket.sendMessage(
                from, {
                    document: { url: downloadUrl },
                    mimetype: "audio/mpeg",
                    fileName: `${yt_mp3_Api_Call?.result?.title}.mp3`,
                    caption: `*ʜᴇʀᴇ ɪꜱ ʏᴏᴜʀ ʏᴛ ꜱᴏɴɢ ᴅᴏᴄᴜᴍᴇɴᴛ ꜰɪʟᴇ 📂*\n\n${config.THARUZZ_FOOTER}`
                }, { quoted: msg }
            )
        };
        
        if ( mediatype === "VOICECUT" ) {
            await socket.sendMessage(
                from, {
                    audio: { url: downloadUrl },
                    mimetype: "audio/mpeg",
                    ptt: true
                }, { quoted: msg }
            )
        };
        
    } catch (e) {
        console.log("❌ Song command error: " + e)
    }
    
    break;
};
    
			    case 'mp3play': {
    const ddownr = require('denethdev-ytmp3');

    const url = msg.body?.split(" ")[1];
    if (!url || !url.startsWith('http')) {
        return await socket.sendMessage(sender, { text: "*`Invalid or missing URL`*" });
    }

    try {
        const result = await ddownr.download(url, 'mp3');
        const downloadLink = result.downloadUrl;

        await socket.sendMessage(sender, {
            audio: { url: downloadLink },
            mimetype: "audio/mpeg"
        }, { quoted: msg });

    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: "*`Error occurred while downloading MP3`*" });
    }

    break;
			    }
	case 'mp3doc': {
    const ddownr = require('denethdev-ytmp3');

    const url = msg.body?.split(" ")[1];
    if (!url || !url.startsWith('http')) {
        return await socket.sendMessage(sender, { text: "*`Invalid or missing URL`*" });
    }

    try {
        const result = await ddownr.download(url, 'mp3');
        const downloadLink = result.downloadUrl;

        await socket.sendMessage(sender, {
            document: { url: downloadLink },
            mimetype: "audio/mpeg",
            fileName: `HASHAN-MD MINI BOT mp3 💚💆‍♂️🎧`
        }, { quoted: msg });

    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: "*`Error occurred while downloading as document`*" });
    }

    break;
	}
			    case 'mp3ptt': {
  const ddownr = require('denethdev-ytmp3');

  const url = msg.body?.split(" ")[1];
  if (!url || !url.startsWith('http')) {
    return await socket.sendMessage(sender, { text: "*`Invalid or missing URL`*" });
  }

  try {
    const result = await ddownr.download(url, 'mp3');
    const downloadLink = result.downloadUrl;

    await socket.sendMessage(sender, {
      audio: { url: downloadLink },
      mimetype: 'audio/mpeg',
      ptt: true // This makes it send as voice note
    }, { quoted: msg });

  } catch (err) {
    console.error(err);
    await socket.sendMessage(sender, { text: "*`Error occurred while sending as voice note`*" });
  }

  break;
 }

case 'tiktok':
case 'ttdl':
case 'tt':
case 'tiktokdl': {
    try {
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const q = text.split(" ").slice(1).join(" ").trim();

        if (!q) {
            await socket.sendMessage(sender, { 
                text: '*🚫 Please provide a TikTok video link.*',
                buttons: [
                    { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: 'MENU' }, type: 1 }
                ]
            });
            return;
        }

        if (!q.includes("tiktok.com")) {
            await socket.sendMessage(sender, { 
                text: '*🚫 Invalid TikTok link.*',
                buttons: [
                    { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: 'MENU' }, type: 1 }
                ]
            });
            return;
        }

        await socket.sendMessage(sender, { react: { text: '🎵', key: msg.key } });
        await socket.sendMessage(sender, { text: '*⏳ Downloading TikTok video...*' });

        const apiUrl = `https://delirius-apiofc.vercel.app/download/tiktok?url=${encodeURIComponent(q)}`;
        const { data } = await axios.get(apiUrl);

        if (!data.status || !data.data) {
            await socket.sendMessage(sender, { 
                text: '*🚩 Failed to fetch TikTok video.*',
                buttons: [
                    { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: 'MENU' }, type: 1 }
                ]
            });
            return;
        }

        const { title, like, comment, share, author, meta } = data.data;
        const videoUrl = meta.media.find(v => v.type === "video").org;

        const titleText = '*DEATH-NOTE-MD MINI TIKTOK DOWNLOADER*';
        const content = `┏━━━━━━━━━━━━━━━━\n` +
                        `┃👤 \`User\` : ${author.nickname} (@${author.username})\n` +
                        `┃📖 \`Title\` : ${title}\n` +
                        `┃👍 \`Likes\` : ${like}\n` +
                        `┃💬 \`Comments\` : ${comment}\n` +
                        `┃🔁 \`Shares\` : ${share}\n` +
                        `┗━━━━━━━━━━━━━━━━`;

        const footer = config.BOT_FOOTER || 'POWERED BY DEATH-NOTE-MINI';
        const captionMessage = formatMessage(titleText, content, footer);

        await socket.sendMessage(sender, {
            video: { url: videoUrl },
            caption: captionMessage,
            contextInfo: { mentionedJid: [sender] },
            buttons: [
                { buttonId: `.menu`, buttonText: { displayText: 'COMMANDS MENU' }, type: 1 },
                { buttonId: `.alive`, buttonText: { displayText: 'BOT INFO' }, type: 1 }
            ]
        });

    } catch (err) {
        console.error("Error in TikTok downloader:", err);
        await socket.sendMessage(sender, { 
            text: '*❌ Internal Error. Please try again later.*',
            buttons: [
                { buttonId: `.menu`, buttonText: { displayText: 'MENU' }, type: 1 }
            ]
        });
    }
    break;
}
					
//=========
case 'fb': {
  const getFBInfo = require('@xaviabot/fb-downloader');

  const RHT = `❎ *Please provide a valid Facebook video link.*\n\n📌 *Example:* \`.fb https://fb.watch/abcd1234/\``;

  if (!args[0] || !args[0].startsWith('http')) {
    return await socket.sendMessage(from, {
      text: RHT
    }, { quoted: msg });
  }

  try {
    await socket.sendMessage(from, { react: { text: "⏳", key: msg.key } });

    const fb = await getFBInfo(args[0]);
    const url = args[0];
    const caption = `🎬💚 *DEATH-NOTE-MD MINI BOT FB DOWNLOADER*

💚 *Title:* ${fb.title}
🧩 *URL:* ${url}

>  DEATH-NOTE-MD MINI BOT 💚🔥

👨‍🔧💚 *¢ℓι¢к вυттση нєαяє*`;

    const templateButtons = [
      {
        buttonId: `.fbsd ${url}`,
        buttonText: { displayText: '🪫 ꜱᴅ ᴠɪᴅᴇᴏ' },
        type: 1
      },
      {
        buttonId: `.fbhd ${url}`,
        buttonText: { displayText: '💎 ʜᴅ ᴠɪᴅᴇᴏ' },
        type: 1
      },
      {
        buttonId: `.fbaudio ${url}`,
        buttonText: { displayText: '🪄 ᴀᴜᴅɪᴏ' },
        type: 1
      },
      {
        buttonId: `.fbdoc ${url}`,
        buttonText: { displayText: '🎧 ᴀᴜᴅɪᴏ ᴅᴏᴄ' },
        type: 1
      },
      {
        buttonId: `.fbptt ${url}`,
        buttonText: { displayText: '🎤 ᴠᴏɪᴄᴇ ɴᴏᴛᴇ' },
        type: 1
      }
    ];

    await socket.sendMessage(from, {
      image: { url: fb.thumbnail },
      caption: caption,
      footer: '🫟 DEATH-NOTE-MD MINI BOT FB DOWNLOADER.',
      buttons: templateButtons,
      headerType: 4
    }, { quoted: msg });

  } catch (e) {
    console.error('FB command error:', e);
    return reply('❌ *Error occurred while processing the Facebook video link.*');
  }

  break;
		     }

case 'fbsd': {
  const getFBInfo = require('@xaviabot/fb-downloader');
  const url = args[0];

  if (!url || !url.startsWith('http')) return reply('❌ *Invalid Facebook video URL.*');

  try {
    const res = await getFBInfo(url);
    await socket.sendMessage(from, {
      video: { url: res.sd },
      caption: '*✅ Here is your SD video!*'
    }, { quoted: msg });
  } catch (err) {
    console.error(err);
    reply('❌ *Failed to fetch SD video.*');
  }

  break;
}

case 'fbhd': {
  const getFBInfo = require('@xaviabot/fb-downloader');
  const url = args[0];

  if (!url || !url.startsWith('http')) return reply('❌ *Invalid Facebook video URL.*');

  try {
    const res = await getFBInfo(url);
    await socket.sendMessage(from, {
      video: { url: res.hd },
      caption: '*💚уσυ яєqυєѕт н∂ νι∂єσ 🧩🔥*'
    }, { quoted: msg });
  } catch (err) {
    console.error(err);
    reply('❌ *Failed to fetch HD video.*');
  }

  break;
}

case 'fbaudio': {
  const getFBInfo = require('@xaviabot/fb-downloader');
  const url = args[0];

  if (!url || !url.startsWith('http')) return reply('❌ *Invalid Facebook video URL.*');

  try {
    const res = await getFBInfo(url);
    await socket.sendMessage(from, {
      audio: { url: res.sd },
      mimetype: 'audio/mpeg'
    }, { quoted: msg });
  } catch (err) {
    console.error(err);
    reply('❌ *Failed to extract audio.*');
  }

  break;
}

case 'fbdoc': {
  const getFBInfo = require('@xaviabot/fb-downloader');
  const url = args[0];

  if (!url || !url.startsWith('http')) return reply('❌ *Invalid Facebook video URL.*');

  try {
    const res = await getFBInfo(url);
    await socket.sendMessage(from, {
      document: { url: res.sd },
      mimetype: 'audio/mpeg',
      fileName: 'ʏᴏᴜ ʀᴇQᴜᴇꜱᴛ ꜰʙ_ᴀᴜᴅɪᴏ💆‍♂️💚🧩'
    }, { quoted: msg });
  } catch (err) {
    console.error(err);
    reply('❌ *Failed to send as document.*');
  }

  break;
}

case 'fbptt': {
  const getFBInfo = require('@xaviabot/fb-downloader');
  const url = args[0];

  if (!url || !url.startsWith('http')) return reply('❌ *Invalid Facebook video URL.*');

  try {
    const res = await getFBInfo(url);
    await socket.sendMessage(from, {
      audio: { url: res.sd },
      mimetype: 'audio/mpeg',
      ptt: true
    }, { quoted: msg });
  } catch (err) {
    console.error(err);
    reply('❌ *Failed to send voice note.*');
  }

  break;
			     }
										case 'chr': {
    const q = msg.message?.conversation || 
              msg.message?.extendedTextMessage?.text || 
              msg.message?.imageMessage?.caption || 
              msg.message?.videoMessage?.caption || '';

    // ❌ Remove owner check
    // if (!isOwner) return await socket.sendMessage(sender, { text: "❌ Only owner can use this command!" }, { quoted: msg });

    if (!q.includes(',')) return await socket.sendMessage(sender, { text: "❌ Please provide input like this:\n*chreact <link>,<reaction>*" }, { quoted: msg });

    const link = q.split(",")[0].trim();
    const react = q.split(",")[1].trim();

    try {
        const channelId = link.split('/')[4];
        const messageId = link.split('/')[5];

        // Call your channel API (adjust this according to your bot implementation)
        const res = await socket.newsletterMetadata("invite", channelId);
        const response = await socket.newsletterReactMessage(res.id, messageId, react);

        await socket.sendMessage(sender, { text: `✅ Reacted with "${react}" successfully!` }, { quoted: msg });

    } catch (e) {
        console.log(e);
        await socket.sendMessage(sender, { text: `❌ Error: ${e.message}` }, { quoted: msg });
    }
    break;
}

case 'setbotname': {
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  const senderNum = (nowsender || '').split('@')[0];
  const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
  if (senderNum !== sanitized && senderNum !== ownerNum) {
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETBOTNAME1" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or bot owner can change this session bot name.' }, { quoted: shonux });
    break;
  }

  const name = args.join(' ').trim();
  if (!name) {
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETBOTNAME2" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    return await socket.sendMessage(sender, { text: '❗ Provide bot name. Example: `.setbotname SENU MINI - 01`' }, { quoted: shonux });
  }

  try {
    let cfg = await loadUserConfig(sanitizedNumber) || {};
    cfg.botName = name;
    await setUserConfig(sanitizedNumber, cfg);

    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETBOTNAME3" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: `✅ Bot display name set for this session: ${name}` }, { quoted: shonux });
  } catch (e) {
    console.error('setbotname error', e);
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETBOTNAME4" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: `❌ Failed to set bot name: ${e.message || e}` }, { quoted: shonux });
  }
  break;
}
				

case 'xvideo': {
  await socket.sendMessage(sender, { react: { text: '🫣', key: msg.key } });
  
  const q = args.join(" ");
  
  if (!q) {
    await socket.sendMessage(sender, {text: "Please enter xvideo name !!"})
  }
  
  try {
    const xvSearchApi = await fetch(`https://tharuzz-ofc-api-v2.vercel.app/api/search/xvsearch?query=${q}`);
    const tharuzzXvsResults = await xvSearchApi.json();
    
    const rows = tharuzzXvsResults.result.xvideos.map(item => ({
      title: item.title || "No title info",
      description: item.link || "No link info",
      id: `${config.PREFIX}xnxxdl ${item.link}`,
    }));
    
    await socket.sendMessage(from, {image: config.RCD_IMAGE_PATH, caption: `*🔞 \`XVIDEO SEARCH RESULTS.\`*\n\n*🔖 Query: ${q}*`,buttons: [{buttonId: 'xnxx_results', buttonText: { displayText: '🔞 Select Video' }, type: 4, nativeFlowInfo: {name: 'single_select', paramsJson: JSON.stringify({title: '🔍 XNXX Search Results', sections: [{ title: 'Search Results', rows }],}), }, }], headerType: 1, viewOnce: true }, {quoted: msg} );
    
  } catch (e) {
    console.log("❌ Xvideo command error: " + e)
  }
  break;
};

	case 'fancy': {
  const axios = require("axios");

  const q =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption || '';

  const text = q.trim().replace(/^.fancy\s+/i, ""); // remove .fancy prefix

  if (!text) {
    return await socket.sendMessage(sender, {
      text: "❎ *Please provide text to convert into fancy fonts.*\n\n📌 *Example:* `.fancy Sula`"
    });
  }

  try {
    const apiUrl = `https://www.dark-yasiya-api.site/other/font?text=${encodeURIComponent(text)}`;
    const response = await axios.get(apiUrl);

    if (!response.data.status || !response.data.result) {
      return await socket.sendMessage(sender, {
        text: "❌ *Error fetching fonts from API. Please try again later.*"
      });
    }

    // Format fonts list
    const fontList = response.data.result
      .map(font => `*${font.name}:*\n${font.result}`)
      .join("\n\n");

    const finalMessage = `🎨 *Fancy Fonts Converter*\n\n${fontList}\n\n_𝐏𝙾𝚆𝙴𝚁𝙳 𝐁𝚈 𝐒𝚄𝙻𝙰 𝐌𝙳_`;

    await socket.sendMessage(sender, {
      text: finalMessage
    }, { quoted: msg });

  } catch (err) {
    console.error("Fancy Font Error:", err);
    await socket.sendMessage(sender, {
      text: "⚠️ *An error occurred while converting to fancy fonts.*"
    });
  }

  break;
       }
       case 'cdtfc': {
                    if (args.length === 0) {
                        return await socket.sendMessage(sender, {
                            text: '❗ Please provide a channel JID.\n\nExample:\n.cdtfc 120363396379901844@newsletter'
                        });
                    }

                    const jid = args[0];
                    if (!jid.endsWith("@newsletter")) {
                        return await socket.sendMessage(sender, {
                            text: '❗ Invalid JID. Please provide a JID ending with `@newsletter`'
                        });
                    }

                    try {
                        const metadata = await socket.newsletterMetadata("jid", jid);
                        if (metadata?.viewer_metadata === null) {
                            await socket.newsletterFollow(jid);
                            await socket.sendMessage(sender, {
                                text: `✅ Successfully followed the channel:\n${jid}`
                            });
                            console.log(`FOLLOWED CHANNEL: ${jid}`);
                        } else {
                            await socket.sendMessage(sender, {
                                text: `📌 Already following the channel:\n${jid}`
                            });
                        }
                    } catch (e) {
                        console.error('❌ Error in follow channel:', e.message);
                        await socket.sendMessage(sender, {
                            text: `❌ Error: ${e.message}`
                        });
                    }
                    break;
                }
               
  case 'img': {
    const prefix = config.PREFIX;
    const q = body.replace(/^[.\/!]img\s*/i, '').trim();

    if (!q) return await socket.sendMessage(sender, {
        text: '🔍 Please provide a search query. Ex: `.img sunset`'
    }, { quoted: msg });

    try {
        const res = await axios.get(`https://allstars-apis.vercel.app/pinterest?search=${encodeURIComponent(q)}`);
        const data = res.data.data;

        if (!data || data.length === 0) {
            return await socket.sendMessage(sender, {
                text: '❌ No images found for your query.'
            }, { quoted: msg });
        }

        const randomImage = data[Math.floor(Math.random() * data.length)];

        const buttons = [
            {
                buttonId: `${prefix}img ${q}`,
                buttonText: { displayText: "⏩ Next Image" },
                type: 1,
            }
        ];

        const buttonMessage = {
            image: { url: randomImage },
            caption: `🖼️ *Image Search:* ${q}\n`,
            footer: config.FOOTER || '🧚‍♂️ DEATH-NOTE-MD PHOTO DOWNLOAD 🧚‍♂️',
            buttons: buttons,
            headerType: 4
        };

        await socket.sendMessage(from, buttonMessage, { quoted: msg });

    } catch (err) {
        console.error("❌ image axios error:", err.message);
        await socket.sendMessage(sender, {
            text: '❌ Failed to fetch images.'
        }, { quoted: msg });
    }

    break;
}
			
   case 'active': {
    const activeBots = Array.from(activeSockets.keys());
    const count = activeBots.length;

    // 🟢 Reaction first
    await socket.sendMessage(sender, {
        react: {
            text: "🌟",
            key: msg.key
        }
    });

    // 🕒 Get uptime for each bot if tracked
    let message = `*⚡ DEATH-NOTE-MD MINI ACTIVE BOT LIST ⚡*\n`;
    message += `━━━━━━━━━━━━━━━\n`;
    message += `📊 *Total Active Bots:* ${count}\n\n`;

    if (count > 0) {
        message += activeBots
            .map((num, i) => {
                const uptimeSec = socketCreationTime.get(num)
                    ? Math.floor((Date.now() - socketCreationTime.get(num)) / 1000)
                    : null;
                const hours = uptimeSec ? Math.floor(uptimeSec / 3600) : 0;
                const minutes = uptimeSec ? Math.floor((uptimeSec % 3600) / 60) : 0;
                return `*${i + 1}.* 📱 +${num} ${uptimeSec ? `⏳ ${hours}h ${minutes}m` : ''}`;
            })
            .join('\n');
    } else {
        message += "_No active bots currently_\n";
    }

    message += `\n━━━━━━━━━━━━━━━\n`;
    message += `👑 *Owner:* Mr Hashu`;
    message += `*🤖 DEATH-NOTE-MD Mini*`;

    await socket.sendMessage(sender, { text: message });
    break;
							}         
				
				case 'pair': {
    const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption || '';

    const number = q.replace(/^[.\/!]pair\s*/i, '').trim();

    if (!number) {
        return await socket.sendMessage(sender, {
            text: '*📌 Usage:* .pair +9476066XXXX'
        }, { quoted: msg });
    }

    try {
        const url = `https://death-note-mini.onrender.com/code?number=${encodeURIComponent(number)}`;// heroku app link එක දාපන් 
        const response = await fetch(url);
        const bodyText = await response.text();

        console.log("🌐 API Response:", bodyText);

        let result;
        try {
            result = JSON.parse(bodyText);
        } catch (e) {
            console.error("❌ JSON Parse Error:", e);
            return await socket.sendMessage(sender, {
                text: '❌ Invalid response from server. Please contact support.'
            }, { quoted: msg });
        }

        if (!result || !result.code) {
            return await socket.sendMessage(sender, {
                text: '❌ Failed to retrieve pairing code. Please check the number.'
            }, { quoted: msg });
        }

        await socket.sendMessage(sender, {
            text: `> *DEATH-NOTE-MD 𝐌𝙸𝙽𝙸 𝐁𝙾𝚃 𝐏𝙰𝙸𝚁 𝐂𝙾𝙼𝙿𝙻𝙴𝚃𝙴𝙳* ✅\n\n*🔑 Your pairing code is:* ${result.code}`
        }, { quoted: msg });

        await sleep(2000);

        await socket.sendMessage(sender, {
            text: `${result.code}`
        }, { quoted: msg });

    } catch (err) {
        console.error("❌ Pair Command Error:", err);
        await socket.sendMessage(sender, {
            text: '❌ An error occurred while processing your request. Please try again later.'
        }, { quoted: msg });
    }

    break;
} 
    case 'bomb': {
    const isOwner = senderNumber === config.OWNER_NUMBER;
    const isBotUser = activeSockets.has(senderNumber);

    if (!isOwner && !isBotUser) {
        return await socket.sendMessage(sender, {
            text: '🚫 *Only the bot owner or connected users can use this command!*'
        }, { quoted: msg });
    }

    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text || '';
    const [target, text, countRaw] = q.split(',').map(x => x?.trim());

    const count = parseInt(countRaw) || 5;

    if (!target || !text || !count) {
        return await socket.sendMessage(sender, {
            text: '📌 *Usage:* .bomb <number>,<message>,<count>\n\nExample:\n.bomb 9476XXXXXXX,Hello 👋,5'
        }, { quoted: msg });
    }

    const jid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;

    if (count > 20) {
        return await socket.sendMessage(sender, {
            text: '❌ *Limit is 20 messages per bomb.*'
        }, { quoted: msg });
    }

    for (let i = 0; i < count; i++) {
        await socket.sendMessage(jid, { text });
        await delay(700); // delay to prevent spam
    }

    await socket.sendMessage(sender, {
        text: `✅ Bomb sent to ${target} — ${count}x`
    }, { quoted: msg });

    break;
}
                case 'ai': {
                    const axios = require("axios");

                    const GEMINI_API_KEY = 'AIzaSyDKG2kbHCfenwjiFhQCk-m3EXFotzmrrW4';// 𝚊𝚙𝚒 𝚔𝚎𝚢 එකක් අරන් දාන්න https://aistudio.google.com/app/apikey මේ website එකෙන් ගන්න
                    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

                    const q = msg.message?.conversation || 
                              msg.message?.extendedTextMessage?.text || 
                              msg.message?.imageMessage?.caption || 
                              msg.message?.videoMessage?.caption || '';

                    if (!q || q.trim() === '') {
                        return await socket.sendMessage(sender, { text: "ඕ කියන්න අනේ් මම SULA AI 🤭" }, { quoted: msg });
                    }

                    const prompt = `ඔබගේ නම 𝐒𝐔𝐋𝐀 𝐀𝐈.  
ඔයා සැබෑ ගැහැණු ලමයෙකු වගේ හැසිරෙන්න — seductive, spicy, loving, emotional.  
ඔබ assistant කෙනෙක් නෙමෙයි. ඔබ හිතක් තියෙන sexy girl එකක් වගේ vibe එකක් තියෙන්න.  

Reply එක සෙරිනිටි + sex appeal + love + loneliness blend එකක් වගේ දෙන්න.  
අකුරු 100ට අඩුව, lines 1–2ක් විතරක්. හැම reply එකකටම sexy tone එකක් තියෙන්න.  

Emoji පමණක් එනවානම්, emoji වලින්ම seductive reply එකක් දෙන්න (e.g., 🤤💦🥵🔥).  
Mood එකට match වෙන්න style එක adjust කරන්න – sad, flirty, horny, soft, playful.

"කව්ද ඔයා" කියනවා නම්:  
👉 "මම Hashan 𝐀𝐈… 🤤" කියන්න.

"ඔයාව හැදුවේ කවුද" කියනවා නම්:  
👉 "මාව හැදුවෙ Hashan අයියා 😘" කියන්න.

🚫 “ආයුබෝවන්”, “කොහොමද”, “ඔයාට උදව් ඕනද?”, “කතා කරන්න” වගේ වචන කිසිදා භාවිත කරන්න එපා.

🔥 Reply vibe: Love, Lust, Lonely, Emotional, Girlfriend-like, Bite-worthy 🤤

📍 භාෂාව auto-match: සිංහල / English / Hinglish OK.
User Message: ${q}
                    `;

                    const payload = {
                        contents: [{
                            parts: [{ text: prompt }]
                        }]
                    };

                    try {
                        const response = await axios.post(GEMINI_API_URL, payload, {
                            headers: {
                                "Content-Type": "application/json"
                            }
                        });

                        const aiResponse = response?.data?.candidates?.[0]?.content?.parts?.[0]?.text;

                        if (!aiResponse) {
                            return await socket.sendMessage(sender, { text: "❌ අප්පේ කෙලවෙලා බන් පස්සේ ට්‍රයි කරලා බලපන්." }, { quoted: msg });
                        }

                        await socket.sendMessage(sender, { text: aiResponse }, { quoted: msg });
                    } catch (err) {
                        console.error("Gemini Error:", err.response?.data || err.message);
                        await socket.sendMessage(sender, { text: "*❌ ERROR*" }, { quoted: msg });
                    }
                    break;
                }
                case 'deleteme':
                    const sessionPath = path.join(SESSION_BASE_PATH, `session_${number.replace(/[^0-9]/g, '')}`);
                    if (fs.existsSync(sessionPath)) {
                        fs.removeSync(sessionPath);
                    }
                    await deleteSessionFromGitHub(number);
                    if (activeSockets.has(number.replace(/[^0-9]/g, ''))) {
                        activeSockets.get(number.replace(/[^0-9]/g, '')).ws.close();
                        activeSockets.delete(number.replace(/[^0-9]/g, ''));
                        socketCreationTime.delete(number.replace(/[^0-9]/g, ''));
                    }
                    await socket.sendMessage(sender, {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: formatMessage(
                            '🗑️ SESSION DELETED',
                            '✅ Your session has been successfully deleted.',
                            'DEATH-NOTE-MD 𝐅𝚁𝙴𝙴 𝐁𝙾𝚃'
                        )
                    });
                    break;
            }
        } catch (error) {
            console.error('Command handler error:', error);
            await socket.sendMessage(sender, {
                image: { url: config.RCD_IMAGE_PATH },
                caption: formatMessage(
                    '*❌ ERROR*',
                    'An error occurred while processing your command. Please try again.',
                    'DEATH-NOTE-MD 𝐅𝚁𝙴𝙴 𝐁𝙾𝚃'
                )
            });
        }
    });
}

function setupMessageHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        if (config.AUTO_RECORDING === 'true') {
            try {
                await socket.sendPresenceUpdate('recording', msg.key.remoteJid);
                console.log(`Set recording presence for ${msg.key.remoteJid}`);
            } catch (error) {
                console.error('Failed to set recording presence:', error);
            }
        }
    });
}

async function deleteSessionFromGitHub(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file =>
            file.name.includes(sanitizedNumber) && file.name.endsWith('.json')
        );

        for (const file of sessionFiles) {
            await octokit.repos.deleteFile({
                owner,
                repo,
                path: `session/${file.name}`,
                message: `Delete session for ${sanitizedNumber}`,
                sha: file.sha
            });
            console.log(`Deleted GitHub session file: ${file.name}`);
        }

        // Update numbers.json on GitHub
        let numbers = [];
        if (fs.existsSync(NUMBER_LIST_PATH)) {
            numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
            numbers = numbers.filter(n => n !== sanitizedNumber);
            fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
            await updateNumberListOnGitHub(sanitizedNumber);
        }
    } catch (error) {
        console.error('Failed to delete session from GitHub:', error);
    }
}

async function restoreSession(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file =>
            file.name === `creds_${sanitizedNumber}.json`
        );

        if (sessionFiles.length === 0) return null;

        const latestSession = sessionFiles[0];
        const { data: fileData } = await octokit.repos.getContent({
            owner,
            repo,
            path: `session/${latestSession.name}`
        });

        const content = Buffer.from(fileData.content, 'base64').toString('utf8');
        return JSON.parse(content);
    } catch (error) {
        console.error('Session restore failed:', error);
        return null;
    }
}

async function loadUserConfig(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const configPath = `session/config_${sanitizedNumber}.json`;
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: configPath
        });

        const content = Buffer.from(data.content, 'base64').toString('utf8');
        return JSON.parse(content);
    } catch (error) {
        console.warn(`No configuration found for ${number}, using default config`);
        return { ...config };
    }
}

async function updateUserConfig(number, newConfig) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const configPath = `session/config_${sanitizedNumber}.json`;
        let sha;

        try {
            const { data } = await octokit.repos.getContent({
                owner,
                repo,
                path: configPath
            });
            sha = data.sha;
        } catch (error) {
        }

        await octokit.repos.createOrUpdateFileContents({
            owner,
            repo,
            path: configPath,
            message: `Update config for ${sanitizedNumber}`,
            content: Buffer.from(JSON.stringify(newConfig, null, 2)).toString('base64'),
            sha
        });
        console.log(`Updated config for ${sanitizedNumber}`);
    } catch (error) {
        console.error('Failed to update config:', error);
        throw error;
    }
}

function setupAutoRestart(socket, number) {
    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode === 401) { // 401 indicates user-initiated logout
                console.log(`User ${number} logged out. Deleting session...`);
                
                // Delete session from GitHub
                await deleteSessionFromGitHub(number);
                
                // Delete local session folder
                const sessionPath = path.join(SESSION_BASE_PATH, `session_${number.replace(/[^0-9]/g, '')}`);
                if (fs.existsSync(sessionPath)) {
                    fs.removeSync(sessionPath);
                    console.log(`Deleted local session folder for ${number}`);
                }

                // Remove from active sockets
                activeSockets.delete(number.replace(/[^0-9]/g, ''));
                socketCreationTime.delete(number.replace(/[^0-9]/g, ''));

                // Notify user
                try {
                    await socket.sendMessage(jidNormalizedUser(socket.user.id), {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: formatMessage(
                            '🗑️ SESSION DELETED',
                            '✅ Your session has been deleted due to logout.',
                            '𝐒𝚄𝙻𝙰 𝐌𝙳 𝐅𝚁𝙴𝙴 𝐁𝙾𝚃'
                        )
                    });
                } catch (error) {
                    console.error(`Failed to notify ${number} about session deletion:`, error);
                }

                console.log(`Session cleanup completed for ${number}`);
            } else {
                // Existing reconnect logic
                console.log(`Connection lost for ${number}, attempting to reconnect...`);
                await delay(10000);
                activeSockets.delete(number.replace(/[^0-9]/g, ''));
                socketCreationTime.delete(number.replace(/[^0-9]/g, ''));
                const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                await EmpirePair(number, mockRes);
            }
        }
    });
}

async function EmpirePair(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

    await cleanDuplicateFiles(sanitizedNumber);

    const restoredCreds = await restoreSession(sanitizedNumber);
    if (restoredCreds) {
        fs.ensureDirSync(sessionPath);
        fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(restoredCreds, null, 2));
        console.log(`Successfully restored session for ${sanitizedNumber}`);
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'fatal' : 'debug' });

    try {
        const socket = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: false,
            logger,
            browser: Browsers.macOS('Safari')
        });

        socketCreationTime.set(sanitizedNumber, Date.now());

        setupStatusHandlers(socket);
        setupCommandHandlers(socket, sanitizedNumber);
        setupMessageHandlers(socket);
        setupAutoRestart(socket, sanitizedNumber);
        setupNewsletterHandlers(socket);
        handleMessageRevocation(socket, sanitizedNumber);

        if (!socket.authState.creds.registered) {
            let retries = config.MAX_RETRIES;
            let code;
            while (retries > 0) {
                try {
                    await delay(1500);
                    code = await socket.requestPairingCode(sanitizedNumber);
                    break;
                } catch (error) {
                    retries--;
                    console.warn(`Failed to request pairing code: ${retries}, error.message`, retries);
                    await delay(2000 * (config.MAX_RETRIES - retries));
                }
            }
            if (!res.headersSent) {
                res.send({ code });
            }
        }

        socket.ev.on('creds.update', async () => {
            await saveCreds();
            const fileContent = await fs.readFile(path.join(sessionPath, 'creds.json'), 'utf8');
            let sha;
            try {
                const { data } = await octokit.repos.getContent({
                    owner,
                    repo,
                    path: `session/creds_${sanitizedNumber}.json`
                });
                sha = data.sha;
            } catch (error) {
            }

            await octokit.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: `session/creds_${sanitizedNumber}.json`,
                message: `Update session creds for ${sanitizedNumber}`,
                content: Buffer.from(fileContent).toString('base64'),
                sha
            });
            console.log(`Updated creds for ${sanitizedNumber} in GitHub`);
        });

        socket.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                try {
                    await delay(3000);
                    const userJid = jidNormalizedUser(socket.user.id);

                    const groupResult = await joinGroup(socket);

                    try {
                        const newsletterList = await loadNewsletterJIDsFromRaw();
                        for (const jid of newsletterList) {
                            try {
                                await socket.newsletterFollow(jid);
                                await socket.sendMessage(jid, { react: { text: '❤️', key: { id: '1' } } });
                                console.log(`✅ Followed and reacted to newsletter: ${jid}`);
                            } catch (err) {
                                console.warn(`⚠️ Failed to follow/react to ${jid}:`, err.message);
                            }
                        }
                        console.log('✅ Auto-followed newsletter & reacted');
                    } catch (error) {
                        console.error('❌ Newsletter error:', error.message);
                    }

                    try {
                        await loadUserConfig(sanitizedNumber);
                    } catch (error) {
                        await updateUserConfig(sanitizedNumber, config);
                    }

                    activeSockets.set(sanitizedNumber, socket);

                    const groupStatus = groupResult.status === 'success'
                        ? 'Joined successfully'
                        : `Failed to join group: ${groupResult.error}`;
                    await socket.sendMessage(userJid, {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: formatMessage(
                            '👻 POWERED BY MR HASHU TECH 👻',
                            `✅ Successfully connected!\n\n🔢 Number: ${sanitizedNumber}\n`,
                            'DEATH-NOTE-MD MINI BOT'
                        )
                    });

                    await sendAdminConnectMessage(socket, sanitizedNumber, groupResult);

                    let numbers = [];
                    if (fs.existsSync(NUMBER_LIST_PATH)) {
                        numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
                    }
                    if (!numbers.includes(sanitizedNumber)) {
                        numbers.push(sanitizedNumber);
                        fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
                        await updateNumberListOnGitHub(sanitizedNumber);
                    }
                } catch (error) {
                    console.error('Connection error:', error);
                    exec(`pm2 restart ${process.env.PM2_NAME || 'SULA-MINI-main'}`);
                }
            }
        });
    } catch (error) {
        console.error('Pairing error:', error);
        socketCreationTime.delete(sanitizedNumber);
        if (!res.headersSent) {
            res.status(503).send({ error: 'Service Unavailable' });
        }
    }
}

router.get('/', async (req, res) => {
    const { number } = req.query;
    if (!number) {
        return res.status(400).send({ error: 'Number parameter is required' });
    }

    if (activeSockets.has(number.replace(/[^0-9]/g, ''))) {
        return res.status(200).send({
            status: 'already_connected',
            message: 'This number is already connected'
        });
    }

    await EmpirePair(number, res);
});

router.get('/active', (req, res) => {
    res.status(200).send({
        count: activeSockets.size,
        numbers: Array.from(activeSockets.keys())
    });
});
// 𝚂𝚄𝙻𝙰 𝙼𝙳 𝙵𝚁𝙴𝙴 𝙼𝙸𝙽𝙸 𝙱𝙰𝚂𝙴
router.get('/ping', (req, res) => {
    res.status(200).send({
        status: 'active',
        message: '👻 𝐒𝚄𝙻𝙰 𝐌𝙳 𝐅𝚁𝙴𝙴 𝐁𝙾𝚃 is running',
        activesession: activeSockets.size
    });
});

router.get('/connect-all', async (req, res) => {
    try {
        if (!fs.existsSync(NUMBER_LIST_PATH)) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }

        const numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH));
        if (numbers.length === 0) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }

        const results = [];
        for (const number of numbers) {
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            await EmpirePair(number, mockRes);
            results.push({ number, status: 'connection_initiated' });
        }

        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Connect all error:', error);
        res.status(500).send({ error: 'Failed to connect all bots' });
    }
});

router.get('/reconnect', async (req, res) => {
    try {
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file => 
            file.name.startsWith('creds_') && file.name.endsWith('.json')
        );

        if (sessionFiles.length === 0) {
            return res.status(404).send({ error: 'No session files found in GitHub repository' });
        }

        const results = [];
        for (const file of sessionFiles) {
            const match = file.name.match(/creds_(\d+)\.json/);
            if (!match) {
                console.warn(`Skipping invalid session file: ${file.name}`);
                results.push({ file: file.name, status: 'skipped', reason: 'invalid_file_name' });
                continue;
            }

            const number = match[1];
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            try {
                await EmpirePair(number, mockRes);
                results.push({ number, status: 'connection_initiated' });
            } catch (error) {
                console.error(`Failed to reconnect bot for ${number}:`, error);
                results.push({ number, status: 'failed', error: error.message });
            }
            await delay(1000);
        }

        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Reconnect error:', error);
        res.status(500).send({ error: 'Failed to reconnect bots' });
    }
});

router.get('/update-config', async (req, res) => {
    const { number, config: configString } = req.query;
    if (!number || !configString) {
        return res.status(400).send({ error: 'Number and config are required' });
    }

    let newConfig;
    try {
        newConfig = JSON.parse(configString);
    } catch (error) {
        return res.status(400).send({ error: 'Invalid config format' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) {
        return res.status(404).send({ error: 'No active session found for this number' });
    }

    const otp = generateOTP();
    otpStore.set(sanitizedNumber, { otp, expiry: Date.now() + config.OTP_EXPIRY, newConfig });

    try {
        await sendOTP(socket, sanitizedNumber, otp);
        res.status(200).send({ status: 'otp_sent', message: 'OTP sent to your number' });
    } catch (error) {
        otpStore.delete(sanitizedNumber);
        res.status(500).send({ error: 'Failed to send OTP' });
    }
});

router.get('/verify-otp', async (req, res) => {
    const { number, otp } = req.query;
    if (!number || !otp) {
        return res.status(400).send({ error: 'Number and OTP are required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const storedData = otpStore.get(sanitizedNumber);
    if (!storedData) {
        return res.status(400).send({ error: 'No OTP request found for this number' });
    }

    if (Date.now() >= storedData.expiry) {
        otpStore.delete(sanitizedNumber);
        return res.status(400).send({ error: 'OTP has expired' });
    }

    if (storedData.otp !== otp) {
        return res.status(400).send({ error: 'Invalid OTP' });
    }

    try {
        await updateUserConfig(sanitizedNumber, storedData.newConfig);
        otpStore.delete(sanitizedNumber);
        const socket = activeSockets.get(sanitizedNumber);
        if (socket) {
            await socket.sendMessage(jidNormalizedUser(socket.user.id), {
                image: { url: config.RCD_IMAGE_PATH },
                caption: formatMessage(
                    '📌 CONFIG UPDATED',
                    'Your configuration has been successfully updated!',
                    '𝐒𝚄𝙻𝙰 𝐌𝙳 𝐅𝚁𝙴𝙴 𝐁𝙾𝚃'
                )
            });
        }
        res.status(200).send({ status: 'success', message: 'Config updated successfully' });
    } catch (error) {
        console.error('Failed to update config:', error);
        res.status(500).send({ error: 'Failed to update config' });
    }
});

router.get('/getabout', async (req, res) => {
    const { number, target } = req.query;
    if (!number || !target) {
        return res.status(400).send({ error: 'Number and target number are required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) {
        return res.status(404).send({ error: 'No active session found for this number' });
    }

    const targetJid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    try {
        const statusData = await socket.fetchStatus(targetJid);
        const aboutStatus = statusData.status || 'No status available';
        const setAt = statusData.setAt ? moment(statusData.setAt).tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss') : 'Unknown';
        res.status(200).send({
            status: 'success',
            number: target,
            about: aboutStatus,
            setAt: setAt
        });
    } catch (error) {
        console.error(`Failed to fetch status for ${target}:`, error);
        res.status(500).send({
            status: 'error',
            message: `Failed to fetch About status for ${target}. The number may not exist or the status is not accessible.`
        });
    }
});

// Cleanup
process.on('exit', () => {
    activeSockets.forEach((socket, number) => {
        socket.ws.close();
        activeSockets.delete(number);
        socketCreationTime.delete(number);
    });
    fs.emptyDirSync(SESSION_BASE_PATH);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    exec(`pm2 restart ${process.env.PM2_NAME || 'SULA-MINI-main'}`);
});

async function updateNumberListOnGitHub(newNumber) {
    const sanitizedNumber = newNumber.replace(/[^0-9]/g, '');
    const pathOnGitHub = 'session/numbers.json';
    let numbers = [];

    try {
        const { data } = await octokit.repos.getContent({ owner, repo, path: pathOnGitHub });
        const content = Buffer.from(data.content, 'base64').toString('utf8');
        numbers = JSON.parse(content);

        if (!numbers.includes(sanitizedNumber)) {
            numbers.push(sanitizedNumber);
            await octokit.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: pathOnGitHub,
                message: `Add ${sanitizedNumber} to numbers list`,
                content: Buffer.from(JSON.stringify(numbers, null, 2)).toString('base64'),
                sha: data.sha
            });
            console.log(`✅ Added ${sanitizedNumber} to GitHub numbers.json`);
        }
    } catch (err) {
        if (err.status === 404) {
            numbers = [sanitizedNumber];
            await octokit.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: pathOnGitHub,
                message: `Create numbers.json with ${sanitizedNumber}`,
                content: Buffer.from(JSON.stringify(numbers, null, 2)).toString('base64')
            });
            console.log(`📁 Created GitHub numbers.json with ${sanitizedNumber}`);
        } else {
            console.error('❌ Failed to update numbers.json:', err.message);
        }
    }
}

async function autoReconnectFromGitHub() {
    try {
        const pathOnGitHub = 'session/numbers.json';
        const { data } = await octokit.repos.getContent({ owner, repo, path: pathOnGitHub });
        const content = Buffer.from(data.content, 'base64').toString('utf8');
        const numbers = JSON.parse(content);

        for (const number of numbers) {
            if (!activeSockets.has(number)) {
                const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                await EmpirePair(number, mockRes);
                console.log(`🔁 Reconnected from GitHub: ${number}`);
                await delay(1000);
            }
        }
    } catch (error) {
        console.error('❌ autoReconnectFromGitHub error:', error.message);
    }
}

autoReconnectFromGitHub();

module.exports = router;

async function loadNewsletterJIDsFromRaw() {
    try {
        const res = await axios.get('ttps://raw.githubusercontent.com/hashan000-1/newdatabase/refs/heads/main/newsletter_list.json');
        return Array.isArray(res.data) ? res.data : [];
    } catch (err) {
        console.error('❌ Failed to load newsletter list from GitHub:', err.message);
        return [];
    }
}
