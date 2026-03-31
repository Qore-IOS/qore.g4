'use client';

import React, { useState, useEffect } from 'react';
import { Palette, Image, Layout, Settings2, MousePointer2, Droplets, Check, Sun, Moon, X, ImageIcon, Monitor, Smartphone, Package, Loader2, Trash2 } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { cn } from '@/lib/utils';
import NextImage from 'next/image';
import { resolveImageSrc } from '@/lib/image-utils';
import { VIEWS } from '@/lib/constants';
import { useIconMappings, getIconSrc } from '@/hooks/useIconMappings';
import Link from 'next/link';
import { db } from '@/lib/firebase';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';

const PUBLIC_IMAGES = [
  '234724.png', '235016.png', '236209.png', '236609.png',
  '303.png', '303 nw.png', '503.png',
  '634404.png', '634503.png', '634602.png', '635305.png', '636800.png',
  '703.png', '703 kit.png', '703kit.png', '703nw.png',
  '801.png', '801 kit.png',
  'A0D5B407-8ADE-4410-B97B-520A830DA0FF.PNG',
  'Başlıksız-2.png', 'Başlıksız-3.png',
  'ChatGPT Image 6 Ağu 2025 09_10_30.png',
  'IFS.png', 'QORE-INV_LOGO.PNG',
  'alkim kartuş.png', 'blk.png', 'e411.png',
  'invitrolab_LOGO__-_Kopya__1_-removebg.png',
  'lab.png', 'lab_diorama.png', 'newlogoblk.png', 'newlogowh.png', 'wt.png',
];

type IconTab = 'dock' | 'mobile' | 'envanter';

export default function KisisellistirmePanel() {
  const { isAdmin, dockStyle, setDockStyle, wallpaper, setWallpaper } = useAuth();
  const { mappings, loading: mappingsLoading, updateMapping } = useIconMappings();

  const [iconFiles, setIconFiles] = useState<string[]>([]);
  const [iconsLoading, setIconsLoading] = useState(true);
  const [iconTab, setIconTab] = useState<IconTab>('dock');
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null);

  // Envanter categories from Firestore
  const [envanterCategories, setEnvanterCategories] = useState<{ id: string; name: string }[]>([]);

  // Fetch icon files from API
  useEffect(() => {
    fetch('/api/icons')
      .then(res => res.json())
      .then(data => setIconFiles(data.icons || []))
      .catch(() => setIconFiles([]))
      .finally(() => setIconsLoading(false));
  }, []);

  // Fetch envanter categories
  useEffect(() => {
    getDocs(query(collection(db, 'assetCategories'), orderBy('name')))
      .then(snap => {
        setEnvanterCategories(snap.docs.map(d => ({ id: d.id, name: d.data().name })));
      })
      .catch((err) => console.error('Failed to load asset categories:', err));
  }, []);

  if (!isAdmin) {
    return (
      <div className="cihaz-shell min-h-screen flex items-center justify-center">
        <div className="cihaz-card-strong p-8 text-center">
          <p className="text-[var(--dashboard-text)] font-semibold">Yetkisiz Erişim</p>
          <p className="text-sm text-[var(--dashboard-muted)] mt-1">Bu panele erişim yetkiniz bulunmamaktadır.</p>
        </div>
      </div>
    );
  }

  const dockStyles = [
    {
      key: 'hover' as const,
      icon: MousePointer2,
      title: 'Hover Görünümü',
      description: 'Mouse ile üzerine gelindiğinde ikonlar büyür ve yukarı kalkar',
    },
    {
      key: 'liquid' as const,
      icon: Droplets,
      title: 'Liquid Glass',
      description: 'Cam efektli seçici mouse ile akışkan şekilde ikonlar arasında kayar',
    },
  ];

  // Items for each icon tab
  const dockItems = VIEWS.filter(v => v.type === 'nav').map(v => ({ key: v.key, label: v.label }));
  const mobileItems = VIEWS.filter(v => v.type === 'nav').map(v => ({ key: v.key, label: v.label }));
  const envanterItems = envanterCategories.map(c => ({ key: c.name, label: c.name }));

  const currentTabItems = iconTab === 'dock' ? dockItems : iconTab === 'mobile' ? mobileItems : envanterItems;
  const currentMappings = mappings[iconTab];

  const handleSelectIcon = async (iconFile: string) => {
    if (!selectedItemKey) return;
    await updateMapping(iconTab, selectedItemKey, iconFile);
  };

  const handleRemoveIcon = async (itemKey: string) => {
    await updateMapping(iconTab, itemKey, null);
    if (selectedItemKey === itemKey) setSelectedItemKey(null);
  };

  return (
    <div className="cihaz-shell min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8 pb-24">

        {/* ===== HEADER ===== */}
        <div className="flex items-center gap-3 mb-6">
          <Link
            href="/yonetim"
            className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          </Link>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-[var(--dashboard-text)]">Kişiselleştirme</h1>
            <p className="text-xs sm:text-sm text-[var(--dashboard-muted)]">Sistem görsel ve arayüz ayarları</p>
          </div>
        </div>

        {/* ===== DOCK STYLE ===== */}
        <div className="cihaz-card-strong p-5 sm:p-6 mb-5">
          <div className="flex items-center gap-2 mb-4">
            <Droplets className="w-5 h-5 text-[var(--dashboard-accent)]" />
            <h2 className="text-sm font-semibold text-[var(--dashboard-text)]">Dock Görünümü</h2>
          </div>
          <p className="text-xs text-[var(--dashboard-muted)] mb-4">Alt navigasyon çubuğunun görünüm stilini seçin.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {dockStyles.map((style) => (
              <button
                key={style.key}
                onClick={() => setDockStyle(style.key)}
                className={cn(
                  'relative flex flex-col items-start p-4 rounded-2xl transition-all duration-200 text-left',
                  dockStyle === style.key
                    ? 'bg-[var(--dashboard-accent)]/10 ring-2 ring-[var(--dashboard-accent)] shadow-md'
                    : 'bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] hover:ring-1 hover:ring-[var(--dashboard-accent)]/30'
                )}
              >
                {dockStyle === style.key && (
                  <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-[var(--dashboard-accent)] text-white flex items-center justify-center">
                    <Check className="w-3 h-3" />
                  </div>
                )}
                <div className="flex items-center gap-3 mb-2">
                  <div className={cn(
                    'p-2 rounded-xl',
                    dockStyle === style.key ? 'bg-[var(--dashboard-accent)]/20' : 'bg-[var(--dashboard-surface)]'
                  )}>
                    <style.icon className={cn('h-5 w-5', dockStyle === style.key ? 'text-[var(--dashboard-accent)]' : 'text-[var(--dashboard-muted)]')} />
                  </div>
                  <span className="text-sm font-medium text-[var(--dashboard-text)]">{style.title}</span>
                </div>
                <p className="text-xs text-[var(--dashboard-muted)] pl-12">{style.description}</p>
                {style.key === 'liquid' && (
                  <div className="mt-2 pl-12">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-gradient-to-r from-blue-500/20 to-purple-500/20 text-blue-500 border border-blue-500/20">
                      Apple Liquid Glass
                    </span>
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* ===== ICONS MANAGEMENT ===== */}
        <div className="cihaz-card-strong p-5 sm:p-6 mb-5">
          <div className="flex items-center gap-2 mb-4">
            <ImageIcon className="w-5 h-5 text-[var(--dashboard-accent)]" />
            <h2 className="text-sm font-semibold text-[var(--dashboard-text)]">İkon Yönetimi</h2>
          </div>
          <p className="text-xs text-[var(--dashboard-muted)] mb-4">
            Dock, mobil menü ve envanter kategorileri için özel ikonlar seçin. İkonları <code className="text-[var(--dashboard-accent)]">public/icons/</code> klasörüne yükleyin.
          </p>

          {/* Tab switcher */}
          <div className="flex items-center gap-1.5 mb-5">
            {([
              { key: 'dock' as IconTab, label: 'Masaüstü Dock', icon: Monitor },
              { key: 'mobile' as IconTab, label: 'Mobil Dock', icon: Smartphone },
              { key: 'envanter' as IconTab, label: 'Envanter', icon: Package },
            ]).map(tab => (
              <button
                key={tab.key}
                onClick={() => { setIconTab(tab.key); setSelectedItemKey(null); }}
                className={cn(
                  'px-3 py-2 rounded-xl text-xs font-semibold transition-all duration-200 flex items-center gap-1.5',
                  iconTab === tab.key
                    ? 'bg-[var(--dashboard-accent)] text-white shadow-md'
                    : 'bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]'
                )}
              >
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* LEFT: Item list */}
            <div>
              <p className="text-[11px] text-[var(--dashboard-muted)] uppercase tracking-wider font-semibold mb-2">
                {iconTab === 'dock' ? 'Dock Öğeleri' : iconTab === 'mobile' ? 'Mobil Menü Öğeleri' : 'Envanter Kategorileri'}
              </p>
              <div className="space-y-1 max-h-[400px] overflow-y-auto pr-1">
                {currentTabItems.map(item => {
                  const hasIcon = !!currentMappings[item.key];
                  return (
                    <button
                      key={item.key}
                      onClick={() => setSelectedItemKey(item.key === selectedItemKey ? null : item.key)}
                      className={cn(
                        'w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-all duration-150',
                        selectedItemKey === item.key
                          ? 'bg-[var(--dashboard-accent)]/10 ring-1 ring-[var(--dashboard-accent)]'
                          : 'bg-[var(--dashboard-surface-2)]/50 hover:bg-[var(--dashboard-surface-2)]'
                      )}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {hasIcon ? (
                          <div className="w-8 h-8 rounded-lg bg-[var(--dashboard-surface)] flex items-center justify-center overflow-hidden shrink-0">
                            <NextImage
                              src={getIconSrc(currentMappings[item.key])}
                              alt=""
                              width={24}
                              height={24}
                              className="object-contain"
                            />
                          </div>
                        ) : (
                          <div className="w-8 h-8 rounded-lg bg-[var(--dashboard-surface-2)] flex items-center justify-center shrink-0">
                            <ImageIcon className="w-3.5 h-3.5 text-[var(--dashboard-muted)]" />
                          </div>
                        )}
                        <span className="text-sm text-[var(--dashboard-text)] truncate">{item.label}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {hasIcon && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRemoveIcon(item.key); }}
                            className="w-6 h-6 rounded-md flex items-center justify-center text-red-400 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                        <span className={cn(
                          'text-[10px] px-1.5 py-0.5 rounded-md font-medium',
                          hasIcon ? 'bg-emerald-500/10 text-emerald-500' : 'bg-[var(--dashboard-surface-2)] text-[var(--dashboard-muted)]'
                        )}>
                          {hasIcon ? 'Ayarlı' : 'Varsayılan'}
                        </span>
                      </div>
                    </button>
                  );
                })}
                {currentTabItems.length === 0 && (
                  <p className="text-center py-6 text-sm text-[var(--dashboard-muted)]">
                    {iconTab === 'envanter' ? 'Henüz envanter kategorisi oluşturulmamış.' : 'Öğe bulunamadı.'}
                  </p>
                )}
              </div>
            </div>

            {/* RIGHT: Icon picker */}
            <div>
              <p className="text-[11px] text-[var(--dashboard-muted)] uppercase tracking-wider font-semibold mb-2">
                {selectedItemKey ? `"${currentTabItems.find(i => i.key === selectedItemKey)?.label}" için ikon seçin` : 'Bir öğe seçin'}
              </p>
              {iconsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-[var(--dashboard-accent)]" />
                </div>
              ) : iconFiles.length === 0 ? (
                <div className="cihaz-pressed p-6 text-center">
                  <ImageIcon className="w-8 h-8 text-[var(--dashboard-muted)] mx-auto mb-2" />
                  <p className="text-sm text-[var(--dashboard-muted)]">İkon bulunamadı</p>
                  <p className="text-xs text-[var(--dashboard-muted)] mt-1">
                    <code>public/icons/</code> klasörüne ikon dosyaları ekleyin
                  </p>
                </div>
              ) : !selectedItemKey ? (
                <div className="cihaz-pressed p-6 text-center">
                  <p className="text-sm text-[var(--dashboard-muted)]">Sol taraftan bir öğe seçin</p>
                </div>
              ) : (
                <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 max-h-[400px] overflow-y-auto pr-1">
                  {iconFiles.map(file => {
                    const isSelected = currentMappings[selectedItemKey] === file;
                    return (
                      <button
                        key={file}
                        onClick={() => handleSelectIcon(file)}
                        className={cn(
                          'relative aspect-square rounded-xl border-2 overflow-hidden transition-all duration-200 hover:scale-105 flex items-center justify-center p-2',
                          isSelected
                            ? 'border-[var(--dashboard-accent)] ring-2 ring-[var(--dashboard-accent)]/30 bg-[var(--dashboard-accent)]/5 shadow-md'
                            : 'border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)] hover:border-[var(--dashboard-accent)]/50'
                        )}
                        title={file}
                      >
                        <NextImage
                          src={getIconSrc(file)}
                          alt={file}
                          width={40}
                          height={40}
                          className="object-contain"
                        />
                        {isSelected && (
                          <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-[var(--dashboard-accent)] text-white flex items-center justify-center">
                            <Check className="w-2.5 h-2.5" />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ===== WALLPAPER ===== */}
        <div className="cihaz-card-strong p-5 sm:p-6 mb-5">
          <div className="flex items-center gap-2 mb-4">
            <Image className="w-5 h-5 text-[var(--dashboard-accent)]" />
            <h2 className="text-sm font-semibold text-[var(--dashboard-text)]">Duvar Kağıdı</h2>
          </div>
          <p className="text-xs text-[var(--dashboard-muted)] mb-5">
            Ürün kullanım panelinin arka planında gösterilecek görseli seçin.
          </p>

          {/* Light Mode */}
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-3">
              <Sun className="h-4 w-4 text-amber-500" />
              <span className="text-xs font-semibold text-[var(--dashboard-text)]">Açık Mod</span>
              {wallpaper.light && (
                <button
                  onClick={() => setWallpaper('light', null)}
                  className="ml-auto flex items-center gap-1 text-[10px] text-red-400 hover:text-red-500"
                >
                  <X className="h-3 w-3" /> Kaldır
                </button>
              )}
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
              {PUBLIC_IMAGES.map((img) => (
                <button
                  key={`light-${img}`}
                  onClick={() => setWallpaper('light', `/${img}`)}
                  className={cn(
                    'relative aspect-square rounded-xl border-2 overflow-hidden transition-all duration-200 hover:scale-105',
                    wallpaper.light === `/${img}`
                      ? 'border-amber-500 ring-2 ring-amber-500/30 shadow-md'
                      : 'border-[var(--dashboard-stroke)] hover:border-amber-500/50'
                  )}
                >
                  <NextImage src={resolveImageSrc(img)} alt={img} fill className="object-cover" sizes="80px" />
                  {wallpaper.light === `/${img}` && (
                    <div className="absolute inset-0 bg-amber-500/20 flex items-center justify-center">
                      <div className="w-4 h-4 rounded-full bg-amber-500 text-white flex items-center justify-center">
                        <Check className="w-2.5 h-2.5" />
                      </div>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Dark Mode */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Moon className="h-4 w-4 text-blue-400" />
              <span className="text-xs font-semibold text-[var(--dashboard-text)]">Koyu Mod</span>
              {wallpaper.dark && (
                <button
                  onClick={() => setWallpaper('dark', null)}
                  className="ml-auto flex items-center gap-1 text-[10px] text-red-400 hover:text-red-500"
                >
                  <X className="h-3 w-3" /> Kaldır
                </button>
              )}
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
              {PUBLIC_IMAGES.map((img) => (
                <button
                  key={`dark-${img}`}
                  onClick={() => setWallpaper('dark', `/${img}`)}
                  className={cn(
                    'relative aspect-square rounded-xl border-2 overflow-hidden transition-all duration-200 hover:scale-105',
                    wallpaper.dark === `/${img}`
                      ? 'border-blue-500 ring-2 ring-blue-500/30 shadow-md'
                      : 'border-[var(--dashboard-stroke)] hover:border-blue-500/50'
                  )}
                >
                  <NextImage src={resolveImageSrc(img)} alt={img} fill className="object-cover" sizes="80px" />
                  {wallpaper.dark === `/${img}` && (
                    <div className="absolute inset-0 bg-blue-500/20 flex items-center justify-center">
                      <div className="w-4 h-4 rounded-full bg-blue-500 text-white flex items-center justify-center">
                        <Check className="w-2.5 h-2.5" />
                      </div>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ===== UPCOMING FEATURES ===== */}
        <div className="cihaz-card-strong p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-4">
            <Settings2 className="w-5 h-5 text-[var(--dashboard-accent)]" />
            <h2 className="text-sm font-semibold text-[var(--dashboard-text)]">Yakında Gelecek</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { icon: Palette, title: 'Tema Renkleri', phase: 'Faz 3' },
              { icon: Layout, title: 'Arayüz Düzeni', phase: 'Faz 4' },
              { icon: Settings2, title: 'Gelişmiş Ayarlar', phase: 'Faz 5' },
            ].map((f) => (
              <div key={f.title} className="cihaz-pressed p-4 text-center opacity-60">
                <f.icon className="h-6 w-6 mx-auto mb-2 text-[var(--dashboard-muted)]" />
                <p className="text-xs font-medium text-[var(--dashboard-text)]">{f.title}</p>
                <span className="text-[10px] text-[var(--dashboard-muted)]">{f.phase}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
