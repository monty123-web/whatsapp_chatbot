import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, Buttons } = pkg;

import qrcode from 'qrcode-terminal';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { saveLead } from './sheets.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server);

app.use(express.static(join(__dirname, 'public')));

// In-memory chat store
const chats = {};

// In-memory user conversation state
const userState = {};

function storeMessage(chatId, name, phone, from, text, timestamp) {
    if (!chats[chatId]) chats[chatId] = { name, phone, messages: [] };
    chats[chatId].name = name;
    chats[chatId].phone = phone;
    chats[chatId].messages.push({ from, text, timestamp });
    if (chats[chatId].messages.length > 100) chats[chatId].messages.shift();
}

// REST APIs for dashboard
app.get('/api/chats', (req, res) => {
    const list = Object.entries(chats).map(([id, data]) => ({
        id,
        name: data.name,
        phone: data.phone,
        lastMessage: data.messages.at(-1) || null,
    }));
    res.json(list);
});

app.get('/api/chats/:chatId/messages', (req, res) => {
    const chat = chats[req.params.chatId];
    if (!chat) return res.status(404).json({ error: 'Not found' });
    res.json(chat.messages);
});

// WhatsApp client
const client = new Client({
    authStrategy: new LocalAuth({ clientId: "main-bot" }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage'
        ]
    }
});
client.on('qr', (qr) => {
    console.log('Scan this QR Code:');
    qrcode.generate(qr, { small: true });
    io.emit('qr', qr);
});

client.on('authenticated', () => {
    console.log('Authenticated!');
    io.emit('status', 'authenticated');
});

client.on('ready', () => {
    console.log('WhatsApp Bot Ready!');
    io.emit('status', 'ready');
});

client.on('message', async (message) => {
    try {
        const chatId = message.from;
        const contact = await message.getContact();
        const name = contact.pushname || contact.name || contact.number;
        const phone = contact.number;
        const text = message.body;
        const timestamp = new Date().toISOString();

        // Initialize user state if not exists
        if (!userState[chatId]) {
            userState[chatId] = {
                selectedCourse: null,
                userName: null,
                userPhone: null,
                step: 'initial'
            };
        }

        // ============================================
        // DEBUG LOGGING - Show all incoming data
        // ============================================
        console.log('\n📨 === INCOMING MESSAGE ===');
        console.log('👤 From:', chatId, '(' + name + ')');
        console.log('📱 Phone:', phone);
        console.log('💬 Message Body:', text);
        console.log('🏷️  Message Type:', message.type);
        console.log('🔘 Selected Button ID:', message.selectedButtonId || 'N/A');
        console.log('📋 Selected Row ID:', message.selectedRowId || 'N/A');
        console.log('👥 User State:', userState[chatId]);
        console.log('⏰ Timestamp:', timestamp);
        console.log('================================\n');

        const buttonId = message.selectedButtonId || '';
        const rowId = message.selectedRowId || '';
        const selectedButtonText = message.selectedButtonId ? (message.body || '') : '';
        const selectedRowText = message.selectedRowId ? (message.body || '') : '';
        const inputText = (text || selectedButtonText || selectedRowText || buttonId || rowId || '').toString().trim();
        const lower = inputText.toLowerCase();
        const displayText = inputText || text || '';

        // Save & broadcast incoming message
        storeMessage(chatId, name, phone, 'user', displayText, timestamp);
        io.emit('message', { chatId, name, phone, from: 'user', text: displayText, timestamp });

        async function botReply(replyText) {
            try {
                console.log('🤖 Bot sending reply to', chatId, ':', replyText.substring(0, 50) + '...');
                await message.reply(replyText);
                const ts = new Date().toISOString();
                storeMessage(chatId, name, phone, 'bot', replyText, ts);
                io.emit('message', { chatId, name, phone, from: 'bot', text: replyText, timestamp: ts });
                console.log('✅ Reply sent successfully');
            } catch (error) {
                console.error('❌ Error sending reply:', error.message);
            }
        }

        // ============================================
        // STEP 1: MENU - Triggered by "hi", "hello", "start"
        // ============================================
        if (lower === 'hi' || lower === 'hello' || lower === 'start') {
            console.log('🎯 Menu triggered by:', lower);
            userState[chatId] = {
                selectedCourse: null,
                userName: null,
                userPhone: null,
                step: 'menu'
            };
            try {
                const buttons = new Buttons(
                    'Namaste 👋 ABC Coaching Institute me welcome hai!\n\nKya chahiye aapko?',
                    [
                        { id: 'jee_courses', body: '📚 JEE Courses' },
                        { id: 'neet_courses', body: '🔬 NEET Courses' },
                        { id: 'free_demo', body: '🆓 Free Demo Class' },
                        { id: 'fees_structure', body: '💰 Fees Structure' }
                    ],
                    'ABC Coaching',
                    'Select an option below'
                );
                await client.sendMessage(chatId, buttons);
                console.log('✅ Buttons menu sent successfully');
                storeMessage(chatId, name, phone, 'bot', '[Menu with buttons sent]', new Date().toISOString());
                io.emit('message', { chatId, name, phone, from: 'bot', text: '[Menu with buttons sent]', timestamp: new Date().toISOString() });
            } catch (error) {
                console.log('⚠️ Buttons failed (', error.message, ') - Sending plain text menu as fallback');
                await botReply(
`Namaste 👋 ABC Coaching Institute me welcome hai!\n\n1️⃣ JEE Courses\n2️⃣ NEET Courses\n3️⃣ Free Demo Class\n4️⃣ Fees Structure\n\nReply with number (1, 2, 3, or 4)`
                );
            }
            return;
        }

        // ============================================
        // STEP 2: COURSE SELECTION (JEE, NEET, DEMO, FEES)
        // ============================================
        if (buttonId === 'jee_courses' || rowId === 'jee_courses' || lower.includes('jee') || lower === '1' || lower.includes('📚')) {
            console.log('🎯 User selected: JEE Courses');
            userState[chatId].selectedCourse = 'JEE Courses';
            userState[chatId].step = 'waiting_for_name';
            await botReply('📚 *JEE Courses*\n\n• JEE Mains + Advanced\n• 2 Year Program\n• Fees: ₹50,000/year\n• Batches: Morning & Evening\n\nGreat! Ab apna *full name* bataao taaki hum aapka admission registration start kar saken.');
            return;
        }

        if (buttonId === 'neet_courses' || rowId === 'neet_courses' || lower.includes('neet') || lower === '2' || lower.includes('🔬')) {
            console.log('🎯 User selected: NEET Courses');
            userState[chatId].selectedCourse = 'NEET Courses';
            userState[chatId].step = 'waiting_for_name';
            await botReply('🔬 *NEET Courses*\n\n• NEET UG Preparation\n• 2 Year Program\n• Fees: ₹45,000/year\n• Batches: Morning & Evening\n\nGreat! Ab apna *full name* bataao taaki hum aapka admission registration start kar saken.');
            return;
        }

        if (buttonId === 'free_demo' || rowId === 'free_demo' || lower.includes('demo') || lower === '3' || lower.includes('🆓')) {
            console.log('🎯 User selected: Free Demo Class');
            userState[chatId].selectedCourse = 'Free Demo Class';
            userState[chatId].step = 'waiting_for_name';
            await botReply('🆓 *Free Demo Class*\n\n📅 Sunday, 10 AM\n🔗 https://example.com/demo\n\nShukriya! Ab apna *full name* bataao taaki hum aapki registration kar saken.');
            return;
        }

        if (buttonId === 'fees_structure' || rowId === 'fees_structure' || lower.includes('fees') || lower.includes('fee') || lower === '4' || lower.includes('💰')) {
            console.log('🎯 User selected: Fees Structure');
            userState[chatId].selectedCourse = 'Fees Structure';
            userState[chatId].step = 'info_sent';
            await botReply('💰 *Fees Structure*\n\n• JEE: ₹50,000/year\n• NEET: ₹45,000/year\n• Foundation (9-10): ₹30,000/year\n\nEMI available!\n📄 Full PDF: https://example.com/fees\n\nAgar aap admission process start karna chahte hain, bas *Hi* type karein aur mein aapki details le lunga.');
            return;
        }

        // ============================================
        // STEP 3: COLLECT NAME AFTER "YES"
        // ============================================
        if ((lower === 'yes' || lower === 'haan' || lower === 'ha') && userState[chatId].step === 'course_selected') {
            console.log('✅ User interested! Asking for name...');
            userState[chatId].step = 'waiting_for_name';
            await botReply(`Great! 🎉\n\nApna *full name* bataao:\n\nExample: John Doe`);
            return;
        }

        // ============================================
        // STEP 4: COLLECT PHONE AFTER NAME
        // ============================================
        if (userState[chatId].step === 'waiting_for_name' && text.length > 2 && !lower.includes('http')) {
            console.log('📝 Received name:', text);
            userState[chatId].userName = text;
            userState[chatId].step = 'waiting_for_phone';
            await botReply(`Nice to meet you, ${text}! 👋\n\nAb apna *WhatsApp Phone Number* bataao:\n\nExample: 91 98765 43210`);
            return;
        }

        // ============================================
        // STEP 5: SAVE TO GOOGLE SHEETS AFTER PHONE
        // ============================================
        if (userState[chatId].step === 'waiting_for_phone') {
            const phoneMatch = text.replace(/\D/g, ''); // Extract only digits
            if (phoneMatch.length >= 10) {
                console.log('📱 Received phone:', phoneMatch);
                userState[chatId].userPhone = phoneMatch;
                userState[chatId].step = 'completed';

                // Save to Google Sheets
                try {
                    const courseName = userState[chatId].selectedCourse || 'Inquiry';
                    const userName = userState[chatId].userName || 'Unknown';
                    const userPhone = phoneMatch;
                    const messageToSave = `${courseName} | Contacted via WhatsApp`;

                    console.log('💾 Saving to Google Sheets...');
                    await saveLead(userName, userPhone, messageToSave);
                    console.log('✅ Lead saved successfully!');

                    await botReply(
`Shukriya! 🙏

Aapka registration complete ho gaya!

📋 *Details Saved:*
👤 Name: ${userName}
📱 Phone: ${userPhone}
📚 Course: ${courseName}

Hum aapko soon contact karenge admission ke liye.

Aur kuch chahiye? Replay *Hi* ya *Menu* 😊`
                    );
                } catch (error) {
                    console.error('❌ Error saving to Google Sheets:', error.message);
                    await botReply(
`Data save hone mein error aaya. 😞

Lekin aapka interest daftar ho gaya!

Team aapko jald contact karega.

Shukriya! 🙏`
                    );
                }
                return;
            } else {
                await botReply('Please enter a valid phone number with at least 10 digits 📱');
                return;
            }
        }

        // ============================================
        // DEFAULT: SHOW HELP IF NO MATCH
        // ============================================
        console.log('ℹ️ No matching option found for:', text);
        await botReply(
`Sorry, I didn't understand that. 😊

Please reply with:
1️⃣ - JEE Courses
2️⃣ - NEET Courses
3️⃣ - Free Demo Class
4️⃣ - Fees Structure

Or say: Hi, Hello, Start`
        );

    } catch (error) {
        console.error('❌ CRITICAL ERROR in message handler:', error.message);
        console.error('📛 Stack trace:', error.stack);
    }
});

// ============================================
// ALTERNATIVE: message_create event (catches all message creation)
// ============================================
client.on('message_create', async (message) => {
    try {
        console.log('📤 MESSAGE CREATE EVENT (outgoing or other type)');
        console.log('Message Type:', message.type);
        console.log('From:', message.from);
        console.log('Body:', message.body);
    } catch (error) {
        console.error('Error in message_create handler:', error.message);
    }
});

// ============================================
// ALTERNATIVE: message_reaction event
// ============================================
client.on('message_reaction', async (reaction) => {
    try {
        console.log('🎭 MESSAGE REACTION EVENT');
        console.log('Emoji:', reaction.reaction);
        console.log('Sender:', reaction.sender);
    } catch (error) {
        console.error('Error in message_reaction handler:', error.message);
    }
});

// ============================================
// ERROR HANDLING: Catch all other errors
// ============================================
client.on('error', (error) => {
    console.error('❌ CLIENT ERROR:', error.message);
});

client.on('disconnected', (reason) => {
    console.warn('⚠️ CLIENT DISCONNECTED:', reason);
});

io.on('connection', (socket) => {
    console.log('Dashboard connected');
    socket.emit('chatList', chats);
});

client.initialize();

server.listen(3000, () => {
    console.log('✅ Server running on http://localhost:3000');
    console.log('📊 Dashboard: http://localhost:3000/dashboard.html');
});
