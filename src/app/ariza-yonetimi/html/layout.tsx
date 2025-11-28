import React from 'react';

// This is a minimal layout specifically for the raw HTML report page,
// avoiding the main AppLayout shell and global styles.
export default function RawHtmlLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="tr">
            <head>
                <title>Açık Arıza Raporu</title>
                <meta name="robots" content="noindex, nofollow" />
                <style>{`
                    body { font-family: sans-serif; padding: 20px; }
                    table { border-collapse: collapse; width: 100%; font-size: 12px; }
                    th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
                    th { background-color: #f2f2f2; }
                    tr:nth-child(even) { background-color: #f9f9f9; }
                `}</style>
            </head>
            <body>
                {children}
            </body>
        </html>
    );
}
