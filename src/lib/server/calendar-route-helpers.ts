/**
 * Takvim OAuth API route'ları için ortak yardımcılar (connect & callback akışı).
 * Yalnızca sunucu tarafı.
 */
import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import {
  type CalendarProvider,
  providerConfigured,
  redirectUri,
  appBaseUrl,
  buildAuthUrl,
  exchangeCodeForToken,
  fetchAccountEmail,
} from './calendar-oauth';
import { createOAuthState, consumeOAuthState } from './calendar-state';
import { saveConnection } from './calendar-store';

const PANEL_PATH = '/satin-alma';

/** Kullanıcıyı sağlayıcı onay ekranına yönlendiren "connect" akışı. */
export async function handleConnect(
  req: NextRequest,
  provider: CalendarProvider,
): Promise<NextResponse> {
  const base = appBaseUrl(req);
  if (!providerConfigured(provider)) {
    return NextResponse.redirect(`${base}${PANEL_PATH}?calendar=${provider}-unconfigured`);
  }

  const token = req.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.redirect(`${base}${PANEL_PATH}?calendar=${provider}-auth-required`);
  }

  let uid: string;
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    uid = decoded.uid;
  } catch {
    return NextResponse.redirect(`${base}${PANEL_PATH}?calendar=${provider}-auth-required`);
  }

  const redirect = redirectUri(req, provider);
  const state = await createOAuthState(uid, provider, redirect);
  return NextResponse.redirect(buildAuthUrl(provider, redirect, state));
}

/** Sağlayıcıdan dönen "callback": kodu token'a çevirir ve bağlantıyı saklar. */
export async function handleCallback(
  req: NextRequest,
  provider: CalendarProvider,
): Promise<NextResponse> {
  const base = appBaseUrl(req);
  const done = (status: string) =>
    NextResponse.redirect(`${base}${PANEL_PATH}?calendar=${status}`);

  const params = req.nextUrl.searchParams;
  const error = params.get('error');
  if (error) return done(`${provider}-error`);

  const code = params.get('code');
  const stateId = params.get('state');
  if (!code || !stateId) return done(`${provider}-error`);

  const state = await consumeOAuthState(stateId, provider);
  if (!state) return done(`${provider}-error`);

  try {
    const tokens = await exchangeCodeForToken(provider, code, state.redirect);
    if (!tokens.refreshToken) {
      // İzin ekranında offline erişim onaylanmadıysa refresh token gelmez.
      return done(`${provider}-error`);
    }
    const email = await fetchAccountEmail(provider, tokens.accessToken);
    await saveConnection(state.uid, provider, {
      email,
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
    });
    return done(`${provider}-connected`);
  } catch (e) {
    console.error(`[calendar] ${provider} callback error:`, (e as Error).message);
    return done(`${provider}-error`);
  }
}
