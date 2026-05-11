import fetch from 'node-fetch';
import FormData from 'form-data';
import { logger } from 'firebase-functions';

/**
 * Sends a PDF document to a WhatsApp recipient (individual or group) using UltraMsg API.
 * 
 * @param pdfBuffer The PDF file as a Buffer
 * @param fileName The name of the file to appear in WhatsApp
 * @param caption The message text to accompany the document
 * @param to The recipient (individual JID like 905xxx or group JID like xxxx@g.us)
 * @param instanceId UltraMsg Instance ID from functions config
 * @param token UltraMsg API Token from functions config
 */
export async function sendWhatsAppDocument(
  pdfBuffer: Buffer,
  fileName: string,
  caption: string,
  to: string,
  instanceId: string,
  token: string
): Promise<{ success: boolean; error?: string; messageId?: string }> {
  try {
    const url = `https://api.ultramsg.com/${instanceId}/messages/document`;
    
    const form = new FormData();
    form.append('token', token);
    form.append('to', to);
    form.append('filename', fileName);
    form.append('caption', caption);
    form.append('document', pdfBuffer, {
      filename: fileName,
      contentType: 'application/pdf',
    });

    const response = await fetch(url, {
      method: 'POST',
      body: form,
      headers: form.getHeaders(),
    });

    const result = await response.json() as any;

    if (response.ok && (result.sent === 'true' || result.sent === true || result.id)) {
      logger.info(`[WhatsApp] Document sent successfully to ${to}. MessageID: ${result.id}`);
      return { success: true, messageId: result.id };
    } else {
      const errorMsg = result.error || JSON.stringify(result);
      logger.error(`[WhatsApp] API returned error: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  } catch (error: any) {
    logger.error(`[WhatsApp] Unexpected error: ${error.message || error}`);
    return { success: false, error: error.message || String(error) };
  }
}
