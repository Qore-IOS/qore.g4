'use client';
import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { BookText } from 'lucide-react';
import DefinitionManager from './DefinitionManager';
import DeviceGroupManager from './DeviceGroupManager'; // Import the new component

const DEFINITION_CONFIG: Array<{ type: DefinitionType; title: string; placeholder: string; isDeviceGroup?: boolean }> = [
  { type: 'def_brands', title: 'Markalar', placeholder: 'Yeni marka adı...' },
  { type: 'def_labGroups', title: 'Laboratuvar Grupları', placeholder: 'Yeni laboratuvar grubu...' },
  { type: 'def_testGroups', title: 'Test Grupları', placeholder: 'Yeni test grubu...' },
  { type: 'def_deviceGroups', title: 'Cihaz Grupları', placeholder: 'Yeni cihaz grubu...', isDeviceGroup: true },
  { type: 'def_productGroups', title: 'Ürün Grupları', placeholder: 'Yeni ürün grubu...' },
  { type: 'def_mainUnits', title: 'Ana Birimler', placeholder: 'Yeni ana birim...' },
];

type DefinitionType =
  | 'def_brands'
  | 'def_labGroups'
  | 'def_testGroups'
  | 'def_deviceGroups'
  | 'def_productGroups'
  | 'def_mainUnits';

export default function UrunKodlariTanimlarPanel() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookText className="h-6 w-6 text-primary" />
            Ürün Tanımlamaları
          </CardTitle>
          <CardDescription>
            Ürün kodlarını oluştururken veya düzenlerken kullanacağınız seçim listelerini buradan yönetin.
          </CardDescription>
        </CardHeader>
      </Card>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {DEFINITION_CONFIG.map(({ type, title, placeholder, isDeviceGroup }) => (
          isDeviceGroup ? (
            <DeviceGroupManager key={type} />
          ) : (
            <DefinitionManager key={type} type={type} title={title} placeholder={placeholder} />
          )
        ))}
      </div>
    </div>
  );
}
