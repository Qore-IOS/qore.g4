/**
 * Terminal adresinin kalıcı yapılandırması.
 *
 * NEDEN VAR: Kurulmuş bir `.exe` çift tıklanarak açılır — ortada ortam
 * değişkeni ayarlayan bir kabuk yoktur. Adres yalnızca `QORE_TERMINAL_URL`'den
 * okunsaydı, paketlenmiş uygulama her açılışta "adres tanımlı değil" derdi ve
 * depo görevlisinin bunu düzeltmesinin bir yolu olmazdı.
 *
 * Öncelik sırası (ilk bulunan kazanır):
 *   1. `QORE_TERMINAL_URL` ortam değişkeni — geliştirme ve geçici override
 *   2. Kullanıcı verisi altındaki `config.json` — ilk açılışta form ile yazılır
 *   3. Uygulamayla paketlenen `config.json` — kurumsal dağıtımda önceden basılır
 *
 * (2) yazılabilir olduğu için adres, yeniden kurulum gerekmeden değiştirilebilir.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

/** Kullanıcıya ait, yazılabilir yapılandırma dosyası. */
function userConfigPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

/** Uygulamayla birlikte paketlenen, salt okunur varsayılanlar. */
function bundledConfigPath() {
  return path.join(__dirname, 'config.json');
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    // Dosya yok ya da bozuk — her ikisi de "yapılandırma yok" demektir.
    return null;
  }
}

/**
 * Adresin kullanılabilir olduğunu doğrular.
 *
 * `http`/`https` dışındaki şemalar reddedilir: `file://` ya da `javascript:`
 * gibi bir değer, pencereyi uygulama dışı bir içeriğe yönlendirmenin yolu
 * olurdu.
 */
function isValidTerminalUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Yapılandırılmış terminal adresini döndürür; yoksa `null`. */
function getTerminalUrl() {
  const candidates = [
    process.env.QORE_TERMINAL_URL,
    readJson(userConfigPath())?.terminalUrl,
    readJson(bundledConfigPath())?.terminalUrl,
  ];

  for (const candidate of candidates) {
    if (isValidTerminalUrl(candidate)) return candidate.trim();
  }
  return null;
}

/**
 * Adresi kullanıcı yapılandırmasına yazar.
 *
 * @returns {{ ok: boolean, error?: string }}
 */
function setTerminalUrl(value) {
  if (!isValidTerminalUrl(value)) {
    return { ok: false, error: 'Adres http:// veya https:// ile başlamalı.' };
  }
  try {
    const target = userConfigPath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify({ terminalUrl: value.trim() }, null, 2), 'utf8');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

module.exports = { getTerminalUrl, setTerminalUrl, isValidTerminalUrl, userConfigPath };
