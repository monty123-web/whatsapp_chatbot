import { google } from "googleapis";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const auth = new google.auth.GoogleAuth({
  keyFile: join(__dirname, "credentials", "google-service-account.json"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

export async function saveLead(name, phone, message) {

  const client = await auth.getClient();

  const sheets = google.sheets({
    version: "v4",
    auth: client
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "Sheet1!A:C",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[name, phone, message]]
    }
  });

  console.log("Lead Saved");
}