import { CariOdemeSidebar } from "@/components/cari-odeme/Sidebar";

export default function CariOdemeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="cari-shell min-h-full h-full flex bg-[#f4f6f4]">
      <CariOdemeSidebar />
      <main className="flex-1 overflow-x-hidden overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
