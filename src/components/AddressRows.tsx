
'use client';
import React from 'react';
import type { AddressDefinition } from '@/lib/types';
import { TableBody, TableRow, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';

interface AddressRowsProps {
  addresses: AddressDefinition[];
  loading: boolean;
  onDelete: (id: string) => void;
}

export const AddressRows: React.FC<AddressRowsProps> = React.memo(({ addresses, loading, onDelete }) => (
  <TableBody>
    {addresses.map(a => (
      <TableRow key={a.id}>
        <TableCell className="font-mono font-code">{a.addressBarcode}</TableCell>
        <TableCell>{a.addressName}</TableCell>
        <TableCell className="text-right">
          <Button
            variant="ghost"
            size="icon"
            disabled={loading}
            onClick={() => onDelete(a.id)}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </TableCell>
      </TableRow>
    ))}
  </TableBody>
));

AddressRows.displayName = 'AddressRows';
