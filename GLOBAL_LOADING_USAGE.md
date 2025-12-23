# Global Loading Kullanım Kılavuzu

Bu dokümantasyon, uygulamanıza eklenen global loading animasyonunun nasıl kullanılacağını açıklar.

## 📖 Genel Bakış

Global loading sistemi, kullanıcı işlemleri sırasında (mal kabul, transfer, arama vb.) uygulamanın "donmuş" görünmesini önler. Splash screen video animasyonundan bağımsız olarak çalışır ve sadece uygulama etkileşime geçilebilir haldeyken, arka planda bir işlem devam ediyorsa gösterilir.

## 🎯 Ne Zaman Kullanılır?

- API çağrıları sırasında
- Veri yükleme işlemlerinde
- Form gönderme işlemlerinde
- Toplu veri işleme operasyonlarında
- Transfer, mal kabul, arama gibi uzun süren işlemlerde

## 💡 Kullanım Örnekleri

### Yöntem 1: Temel Kullanım (Manuel)

```tsx
'use client';

import { useGlobalLoading } from '@/hooks/useGlobalLoading';

export default function MyComponent() {
  const { startLoading, stopLoading } = useGlobalLoading();

  const handleMalKabul = async () => {
    startLoading(); // Loading'i başlat

    try {
      await performMalKabulOperation();
      // İşlem başarılı
    } catch (error) {
      console.error(error);
    } finally {
      stopLoading(); // Loading'i kapat (mutlaka finally içinde!)
    }
  };

  return (
    <button onClick={handleMalKabul}>
      Mal Kabul Yap
    </button>
  );
}
```

### Yöntem 2: Otomatik Kullanım (withLoading wrapper)

```tsx
'use client';

import { useGlobalLoading } from '@/hooks/useGlobalLoading';

export default function MyComponent() {
  const { withLoading } = useGlobalLoading();

  // withLoading fonksiyonu otomatik olarak loading'i yönetir
  const handleTransfer = withLoading(async () => {
    await performTransferOperation();
    // Hata olsa bile loading otomatik olarak kapanır
  });

  return (
    <button onClick={handleTransfer}>
      Transfer Yap
    </button>
  );
}
```

### Yöntem 3: React Query ile Kullanım

```tsx
'use client';

import { useGlobalLoading } from '@/hooks/useGlobalLoading';
import { useMutation } from '@tanstack/react-query';

export default function SearchPanel() {
  const { startLoading, stopLoading } = useGlobalLoading();

  const searchMutation = useMutation({
    mutationFn: async (query: string) => {
      return await fetchSearchResults(query);
    },
    onMutate: () => {
      startLoading(); // Sorgu başladığında
    },
    onSettled: () => {
      stopLoading(); // Sorgu tamamlandığında (başarılı veya hatalı)
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
