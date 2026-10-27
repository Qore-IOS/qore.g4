'use client';
import React from 'react';
import {useTerminalTheme} from '@/hooks/useTerminalTheme';
import {TerminalPrefetchProvider} from '@/components/terminal/prefetch-provider';
export default function TerminalLayout({children}:{children:React.ReactNode}){useTerminalTheme();return <TerminalPrefetchProvider>{children}</TerminalPrefetchProvider>;}
