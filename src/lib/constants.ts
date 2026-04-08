

import type { AppView } from './types';
import { LayoutDashboard, Package, TestTube, BarChart3, Settings, ScanBarcode, ShieldCheck, TrendingUp, PackagePlus, Server, CheckSquare, LogOut, Moon, Map, ShoppingBag, Truck, Activity, Archive, BookText, Bell, Search, SprayCan, ClipboardPlus, UserCog, ListChecks, Unplug, ListTodo, ShoppingCart, LifeBuoy, Wallet } from 'lucide-react';

// VIEWS dizisi Türkçeleştirildi ve "Hastane" "Laboratuvar" olarak güncellendi.
// URL'ler kebab-case yapısına uygun güncellendi.
export const VIEWS: { key: string; label: string; icon: React.ElementType; type: 'nav' | 'action', href?: string, onClick?: () => void }[] = [
  { key: 'dashboard', label: 'Ana Panel', icon: LayoutDashboard, type: 'nav', href: '/dashboard' },
  { key: 'planner', label: 'Planner', icon: ListTodo, type: 'nav' }, // onClick will be handled in app-layout
  { key: 'arama', label: 'Arama', icon: Search, type: 'nav', href: '/arama' },
  { key: 'mal-kabul', label: 'Mal Kabul', icon: PackagePlus, type: 'nav', href: '/mal-kabul' },
  { key: 'siparisler', label: 'Siparişler', icon: ShoppingBag, type: 'nav', href: '/siparisler' },
  { key: 'direkt-transfer', label: 'Direkt Transfer', icon: Truck, type: 'nav', href: '/direkt-transfer' },
  { key: 'stok-yonetimi', label: 'Stok Yönetimi', icon: Package, type: 'nav', href: '/stok-yonetimi' },
  { key: 'depo-sayim', label: 'Depo Sayım', icon: ListChecks, type: 'nav', href: '/depo-sayim' },
  { key: 'route-planlayici', label: 'Route Planlayıcı', icon: Map, type: 'nav', href: '/route-planlayici' },
  { key: 'laboratuvar-yonetimi', label: 'Lab. Stok Yönetimi', icon: TestTube, type: 'nav', href: '/laboratuvar-yonetimi' },
  { key: 'urun-kullanim', label: 'Ürün Kullanım', icon: ScanBarcode, type: 'nav', href: '/urun-kullanim' },
  { key: 'sarf-dagitim', label: 'Sarf Dağıtım', icon: ClipboardPlus, type: 'nav', href: '/sarf-dagitim'},
  { key: 'numune-arsivi', label: 'Numune Arşivi', icon: Archive, type: 'nav', href: '/numune-arsivi' },
  { key: 'cihazdan-cikan-kit', label: 'Cihazdan Çıkan Kit', icon: Unplug, type: 'nav', href: '/cihazdan-cikan-kit' },
  { key: 'is-analizi', label: 'İş Analizi', icon: TrendingUp, type: 'nav', href: '/is-analizi'},
  { key: 'total-verimlilik', label: 'Total Verimlilik', icon: BarChart3, type: 'nav', href: '/total-verimlilik' },
  { key: 'cost-dashboard', label: 'Maliyet Paneli', icon: Wallet, type: 'nav', href: '/cost-dashboard' },
  { key: 'cihaz-yonetimi-ana', label: 'Cihaz Yönetimi', icon: Server, type: 'nav', href: '/cihaz-yonetimi-ana' },
  { key: 'raporlama', label: 'Raporlama', icon: BarChart3, type: 'nav', href: '/raporlama' },
  { key: 'cihaz-ustu-ekle', label: 'Cihaz Üstü Ekle', icon: Activity, type: 'nav', href: '/raporlama/cihaz-ustu-ekle'},
  { key: 'cihaz-ustu-gecmisi', label: 'Cihaz Üstü Geçmişi', icon: Archive, type: 'nav', href: '/raporlama/cihaz-ustu-gecmisi'},
  { key: 'personel-islemleri', label: 'Personel İşlemleri', icon: UserCog, type: 'nav', href: '/personel-islemleri'},
  { key: 'tanimlar', label: 'Tanımlar', icon: BookText, type: 'nav', href: '/yonetim/tanimlar' },
  { key: 'satin-alma', label: 'Planlama Birimi', icon: ShoppingCart, type: 'nav', href: '/satin-alma' },
  { key: 'kullanici-talepleri', label: 'Talepler', icon: LifeBuoy, type: 'nav', href: '/kullanici-talepleri' },
  { key: 'yonetim', label: 'Yönetim', icon: Settings, type: 'nav', href: '/yonetim' },
];

export const DOCK_ACTIONS: { key: string; label: string; icon: React.ElementType; type: 'action' }[] = [
  { key: 'notifications', label: 'Bildirimler', icon: Bell, type: 'action' },
  { key: 'theme', label: 'Temayı Değiştir', icon: Moon, type: 'action' },
  { key: 'logout', label: 'Çıkış Yap', icon: LogOut, type: 'action' },
];


export const DISPOSAL_BARCODE_LENGTH = 27;
export const DISPOSAL_LOT_LENGTH = 8;
