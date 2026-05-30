============================
 WhatsApp Bot - Setup Guide
============================

STEPS TO RUN:
1. Open Command Prompt (cmd) - NOT PowerShell
2. cd /d "D:\whatsapp-bot - _v2\server"
3. npm install
4. node index.js
5. Scan QR code in WhatsApp
6. Open http://localhost:3000/dashboard.html

FOLDER STRUCTURE:
server/
  index.js          <- main bot file
  ai.js             <- AI replies
  sheets.js         <- Google Sheets
  package.json
  public/
    dashboard.html  <- web dashboard
