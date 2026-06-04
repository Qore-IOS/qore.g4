export default function CariOdemeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="cari-shell min-h-[calc(100dvh-76px)] flex flex-col">
      {children}
    </div>
  );
}
