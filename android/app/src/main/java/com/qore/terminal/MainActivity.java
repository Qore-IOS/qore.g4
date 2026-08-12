package com.qore.terminal;

import android.os.Bundle;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Terminalin Android kabuğu — TAM EKRAN (immersive).
 *
 * NEDEN: Bu bir depo terminali; ekranın tamamı işe ayrılmalı. Üstteki durum
 * çubuğu (saat, pil, bildirimler) ve alttaki gezinme çubuğu hem yer yiyor hem
 * de vardiya ortasında gelen bir bildirim okutma akışını bölüyor. Cihaz çoğu
 * zaman tek bir işe adanmış olarak duruyor.
 *
 * NASIL: Sistem çubukları gizleniyor ve davranışları "kenardan kaydırınca
 * GEÇİCİ olarak görünsün" biçimine ayarlanıyor. Böylece kullanıcı gerektiğinde
 * (saate bakmak, bildirime ulaşmak) çubukları çağırabiliyor; birkaç saniye
 * sonra kendiliğinden kayboluyorlar. Tamamen erişilemez yapmak — gerçek kiosk
 * kilidi — cihazın sahiplik ayarlarını gerektirir ve kullanıcıyı telefonundan
 * eder; istenen bu değil.
 *
 * `setDecorFitsSystemWindows(false)` BİLEREK ÇAĞRILMIYOR:
 * Pencere yerleşimi sistemin insets hesabına bırakılırsa yazılım klavyesi
 * açıldığında içerik yukarı itilmeye devam eder. Kendi hesabımıza geçseydik
 * raf adresi / irsaliye numarası gibi alanlar klavyenin ALTINDA kalırdı.
 * Çubuklar gizli olduğu için zaten insets sıfır ve içerik ekranı dolduruyor —
 * ikisini birden yapmaya gerek yok.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        enterImmersiveMode();
    }

    /**
     * Çubuklar geri geldiğinde yeniden gizle.
     *
     * Sistem, uygulama odağı kaybedip geri kazandığında (bildirim gölgesi,
     * izin penceresi, kamera izni, paylaşım sayfası) çubukları kalıcı olarak
     * geri getiriyor. Bu geri çağrı olmadan uygulama ilk izin isteğinden sonra
     * tam ekranlığını kaybediyor ve bir daha kazanmıyor.
     */
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            enterImmersiveMode();
        }
    }

    private void enterImmersiveMode() {
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());

        controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());
    }
}
