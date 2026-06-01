"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";

export function Pager({ nextCursor }: { nextCursor: string | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleNavigation = (newCursor: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (newCursor) {
      params.set("cursor", newCursor);
    } else {
      params.delete("cursor");
    }
    router.push(`?${params.toString()}`);
  };

  return (
    <div className="flex items-center gap-2 mt-4">
      <Button variant="outline" onClick={() => handleNavigation(null)} disabled={!searchParams.get("cursor")}>
        İlk
      </Button>
      <Button variant="outline" onClick={() => window.history.back()}>
        Önceki
      </Button>
      <Button variant="outline" onClick={() => nextCursor && handleNavigation(nextCursor)} disabled={!nextCursor}>
        Sonraki
      </Button>
    </div>
  );
}
