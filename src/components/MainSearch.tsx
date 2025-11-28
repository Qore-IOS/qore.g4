'use client';
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export default function MainSearch({ onSearch }: { onSearch: (query: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");

  const handleSearch = () => {
    if (query.trim() !== "") onSearch(query);
  };
  
  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    // Check if the new focused element is not a child of the search container
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      if (query.trim() === '') {
        setExpanded(false);
      }
    }
  };

  return (
    <div className="w-full fixed top-0 left-0 flex justify-center z-50 pt-4 pointer-events-none">
      <div
        onClick={() => setExpanded(true)}
        onBlur={handleBlur}
        className={cn(
          "transition-all duration-500 ease-in-out bg-black/20 backdrop-blur-xl border border-white/20 rounded-full flex items-center gap-2 pointer-events-auto",
          expanded ? "w-full max-w-lg shadow-2xl shadow-black/30" : "w-14 h-14 justify-center cursor-pointer hover:bg-black/30"
        )}
      >
        <Search size={20} className={cn("text-white/80 transition-colors", expanded ? "ml-4 text-white/60" : "text-white/80")} />
        {expanded && (
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Ürün, Lot veya Seri No ile Ekstre Ara..."
            className="bg-transparent text-white placeholder:text-white/60 border-none h-12 focus-visible:ring-0 focus-visible:ring-offset-0 caret-white !pl-2"
          />
        )}
      </div>
    </div>
  );
}
