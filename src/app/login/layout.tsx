
import React from 'react';

export default function LoginLayout({ children }: { children: React.ReactNode }) {
    // This is a minimal layout specifically for the login page,
    // avoiding the main AppLayout shell.
    return <>{children}</>;
}
