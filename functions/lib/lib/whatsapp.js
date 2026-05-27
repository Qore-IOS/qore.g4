"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendWhatsAppText = sendWhatsAppText;
exports.sendWhatsAppDocument = sendWhatsAppDocument;
const node_fetch_1 = __importDefault(require("node-fetch"));
const firebase_functions_1 = require("firebase-functions");
/**
 * Sends a plain text WhatsApp message via UltraMsg API.
 *
 * @param to The recipient JID (e.g. `905xxxxxxxxx@c.us` for individual or `...@g.us` for group)
 * @param body The message text
 * @param instanceId UltraMsg Instance ID
 * @param token UltraMsg API Token
 */
async function sendWhatsAppText(to, body, instanceId, token) {
    try {
        const url = `https://api.ultramsg.com/${instanceId}/messages/chat?token=${token}`;
        const response = await (0, node_fetch_1.default)(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to, body }),
        });
        const result = await response.json();
        if (response.ok && (result.sent === 'true' || result.sent === true || result.id)) {
            firebase_functions_1.logger.info(`[WhatsApp] Text sent successfully to ${to}.`);
            return { success: true, messageId: result.id };
        }
        const errorMsg = typeof result.error === 'object' ? JSON.stringify(result.error) : (result.error || JSON.stringify(result));
        firebase_functions_1.logger.error(`[WhatsApp] Text API returned error: ${errorMsg}`);
        return { success: false, error: errorMsg };
    }
    catch (error) {
        firebase_functions_1.logger.error(`[WhatsApp] Text unexpected error: ${error.message || error}`);
        return { success: false, error: error.message || String(error) };
    }
}
/**
 * Sends a PDF document to a WhatsApp recipient via URL using UltraMsg API.
 *
 * @param documentUrl The public URL of the PDF file
 * @param fileName The name of the file
 * @param caption The message text
 * @param to The recipient JID
 * @param instanceId UltraMsg Instance ID
 * @param token UltraMsg API Token
 */
async function sendWhatsAppDocument(documentUrl, fileName, caption, to, instanceId, token) {
    try {
        const url = `https://api.ultramsg.com/${instanceId}/messages/document?token=${token}`;
        const response = await (0, node_fetch_1.default)(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                to,
                filename: fileName,
                document: documentUrl,
                caption: caption
            }),
        });
        const result = await response.json();
        if (response.ok && (result.sent === 'true' || result.sent === true || result.id)) {
            firebase_functions_1.logger.info(`[WhatsApp] Document URL sent successfully to ${to}.`);
            return { success: true, messageId: result.id };
        }
        else {
            const errorMsg = typeof result.error === 'object' ? JSON.stringify(result.error) : (result.error || JSON.stringify(result));
            firebase_functions_1.logger.error(`[WhatsApp] API returned error: ${errorMsg}`);
            return { success: false, error: errorMsg };
        }
    }
    catch (error) {
        firebase_functions_1.logger.error(`[WhatsApp] Unexpected error: ${error.message || error}`);
        return { success: false, error: error.message || String(error) };
    }
}
//# sourceMappingURL=whatsapp.js.map