# Global Loading Kullanım Kılavuzu

Bu dokümantasyon, uygulamanıza eklenen global loading animasyonunun nasıl kullanılacağını açıklar.

## 📖 Genel Bakış

Global loading sistemi, kullanıcı işlemleri sırasında (mal kabul, transfer, arama vb.) uygulamanın "donmuş" görünmesini önler. Splash screen video animasyonundan bağımsız olarak çalışır ve sadece uygulama etkileşime geçilebilir haldeyken, arka planda bir işlem devam ediyorsa gösterilir.

## ⚡ OTOMATİK ÇALIŞAN DURUMLAR

Aşağıdaki işlemler için **hiçbir kod değişikliği gerekmez**, loading animasyonu otomatik gösterilir:

✅ **React Query Mutations** - Tüm `useMutation` çağrıları otomatik
✅ **React Query Queries** - İlk yükleme sırasında otomatik
✅ **Firebase Queries** - `useFirebaseQueries` ile yapılan tüm sorgular

Yani sipariş, mal kabul, transfer, arama gibi sayfalarda **React Query kullanıyorsanız zaten otomatik çalışıyor!**

## 🎯 Manuel Kullanım Gereken Durumlar

Sadece şu durumlarda manuel olarak eklemeniz gerekir:

- Direkt Firebase write işlemleri (setDoc, updateDoc, deleteDoc)
- React Query dışında yapılan API çağrıları
- Uzun hesaplama işlemleri
- Custom async operasyonlar

## 💡 Kullanım Örnekleri

### Yöntem 1: React Query (OTOMATİK - ÖNERİLEN) ✨

```tsx
'use client';

import { useMutation } from '@tanstack/react-query';

export default function SearchPanel() {
  // Loading OTOMATİK olarak gösterilir!
  const searchMutation = useMutation({
    mutationFn: async (query: string) => {
      return await fetchSearchResults(query);
    },
  });

  return (
    <div>
      <input
        onChange={(e) => searchMutation.mutate(e.target.value)}
        placeholder="Ara..."
      />
    </div>
  );
}
```

**Hiçbir ek kod gerekmez! React Query otomatik loading'i halleder.**

### Yöntem 2: Firebase Write İşlemleri

```tsx
'use client';

import { useFirebaseOperation } from '@/hooks/useFirebaseOperation';
import { setDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export default function MalKabulPage() {
  const { executeWithLoading } = useFirebaseOperation();

  const handleMalKabul = async (data: any) => {
    await executeWithLoading(async () => {
      await setDoc(doc(db, 'malKabul', data.id), data);
      await setDoc(doc(db, 'inventory', data.stockCode), inventoryUpdate);
    });
  };

  return (
    <button onClick={() => handleMalKabul(data)}>
      Mal Kabul Yap
    </button>
  );
}
```

### Yöntem 3: Custom Async İşlemler

```tsx
'use client';

import { useGlobalLoading } from '@/hooks/useGlobalLoading';

export default function MyComponent() {
  const { withLoading } = useGlobalLoading();

  // withLoading fonksiyonu otomatik olarak loading'i yönetir
  const handleComplexOperation = withLoading(async () => {
    await step1();
    await step2();
    await step3();
    // Hata olsa bile loading otomatik olarak kapanır
  });

  return (
    <button onClick={handleComplexOperation}>
      İşlemi Başlat
    </button>
  );
}
```

### Yöntem 4: Manuel Kontrol (Nadiren Gerekir)

```tsx
'use client';

import { useGlobalLoading } from '@/hooks/useGlobalLoading';

export default function MyComponent() {
  const { startLoading, stopLoading } = useGlobalLoading();

  const handleOperation = async () => {
    startLoading();

    try {
      await performOperation();
    } catch (error) {
      console.error(error);
    } finally {
      stopLoading(); // Mutlaka finally içinde!
    }
  };

  return (
    <button onClick={handleOperation}>
      İşlem Yap
    </button>
  );
}
```

### Yöntem 4: Form Submit ile Kullanım

```tsx
'use client';

import { useGlobalLoading } from '@/hooks/useGlobalLoading';
import { useForm } from 'react-hook-form';

export default function ProductForm() {
  const { withLoading } = useGlobalLoading();
  const { handleSubmit, register } = useForm();

  const onSubmit = withLoading(async (data) => {
    await saveProduct(data);
    // Loading otomatik yönetilir
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register('name')} />
      <button type="submit">Kaydet</button>
    </form>
  );
}
```

### Yöntem 5: Birden Fazla İşlem

```tsx
'use client';

import { useGlobalLoading } from '@/hooks/useGlobalLoading';

export default function ComplexOperation() {
  const { startLoading, stopLoading, isLoading } = useGlobalLoading();

  const handleComplexProcess = async () => {
    startLoading();

    try {
      // Adım 1
      await step1();

      // Adım 2
      await step2();

      // Adım 3
      await step3();

    } catch (error) {
      console.error(error);
    } finally {
      stopLoading();
    }
  };

  return (
    <div>
      <button onClick={handleComplexProcess} disabled={isLoading}>
        İşlemi Başlat
      </button>
    </div>
  );
}
```

## ⚠️ Önemli Notlar

1. **Finally Kullanımı**: Manuel olarak `startLoading` kullanıyorsanız, `stopLoading`'i mutlaka `finally` bloğu içinde çağırın. Aksi takdirde hata durumunda loading ekranda kalabilir.

2. **Otomatik Yönetim**: Mümkün olduğunca `withLoading` wrapper'ını kullanın. Hata yönetimini otomatik yapar.

3. **Nested Loading**: İç içe loading çağrıları yapmaktan kaçının. Gerekirse üst seviyede tek bir loading kullanın.

4. **Splash Screen İlişkisi**: Global loading, splash screen bitene kadar gösterilmez. Sadece uygulama etkileşime geçilebilir haldeyken aktif olur.

5. **Performance**: Loading state değişikliği optimize edilmiştir (`useCallback` kullanılır), ancak gereksiz yere açıp kapatmaktan kaçının.

## 🎨 Görsel Özelleştirme

Loading animasyonu otomatik olarak:
- Ekranı hafif karartır (`bg-black/60`)
- Arka planı bulanıklaştırır (`backdrop-blur-sm`)
- Yumuşak fade-in animasyonu gösterir
- Merkezde özel loader animasyonunu gösterir

Renkleri değiştirmek isterseniz `src/components/ui/GlobalLoader.tsx` dosyasındaki CSS değişkenlerini düzenleyebilirsiniz:
- `--color-one`: Ana renk
- `--color-two`: İkinci renk
- `--time-animation`: Animasyon hızı

## 🔍 Debugging

Loading state'ini kontrol etmek için:

```tsx
const { isLoading } = useGlobalLoading();

console.log('Global Loading Active:', isLoading);
```

## 📁 Dosya Yapısı

```
src/
├── components/
│   ├── ui/
│   │   └── GlobalLoader.tsx          # Loader animasyon komponenti
│   └── GlobalLoadingOverlay.tsx      # Overlay wrapper komponenti
├── contexts/
│   └── loading-context.tsx           # Loading state yönetimi
└── hooks/
    └── useGlobalLoading.ts           # Kullanım kolaylığı için hook
```

## ✅ Örnek Senaryolar

### Mal Kabul Sayfası
```tsx
const { withLoading } = useGlobalLoading();

const handleMalKabul = withLoading(async (barcodeData) => {
  await processMalKabul(barcodeData);
  await updateInventory();
  await generateReport();
});
```

### Arama Paneli
```tsx
const { startLoading, stopLoading } = useGlobalLoading();

useEffect(() => {
  if (searchQuery.length > 2) {
    startLoading();
    fetchResults(searchQuery)
      .then(setResults)
      .finally(() => stopLoading());
  }
}, [searchQuery]);
```

### Transfer İşlemi
```tsx
const { withLoading } = useGlobalLoading();

const handleTransfer = withLoading(async (items, destination) => {
  await validateTransfer(items);
  await executeTransfer(items, destination);
  await notifyRecipient(destination);
});
```

## 🚀 Başlangıç

Sistemi kullanmaya başlamak için sadece hook'u import edin:

```tsx
import { useGlobalLoading } from '@/hooks/useGlobalLoading';
```

Geri kalan her şey hazır! 🎉
