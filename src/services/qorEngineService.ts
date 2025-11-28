
'use server';

import type { DeviceFaultReportPayload } from '@/lib/types';

// **SECURITY IMPROVEMENT:** API endpoint is now sourced from environment variables.
// This prevents hardcoding sensitive information directly in the source code.
// It must be set in your Vercel/Netlify/Docker environment.
const API_ENDPOINT = process.env.QORE_ENGINE_API_ENDPOINT;

/**
 * Sends a fault report to the external Qore Engine API.
 * @param payload The fault report data to send.
 */
export async function sendFaultReportToQorEngine(payload: DeviceFaultReportPayload): Promise<void> {
  // Endpoint yapılandırılmamışsa devam etme.
  if (!API_ENDPOINT) {
    console.warn('QORE_ENGINE_API_ENDPOINT environment variable is not set. Skipping external fault report.');
    return;
  }

  try {
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Example for API Key authentication, if needed.
        // 'Authorization': `Bearer ${process.env.QORE_ENGINE_API_KEY}`
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`Harici API'ye arıza raporu gönderilemedi. Status: ${response.status}`, { errorBody });
      throw new Error(`API call failed with status: ${response.status}`);
    }

    console.log('Arıza raporu harici API\'ye başarıyla gönderildi.');
    
  } catch (error) {
    console.error("Harici API'ye gönderim sırasında bir hata oluştu:", error);
    // This error is re-thrown to let the calling Cloud Function know that the step failed.
    // This allows for retries or further error handling in the function log.
    throw error;
  }
}
