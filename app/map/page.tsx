import Link from "next/link";
import { createClient } from "@/lib/supabase-server";
import { Logo } from "@/components/Logo";
import MapView from "@/components/Map/MapView";

export default async function MapPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("map_poi_categories")
    .select("id, slug, name_fa, icon")
    .eq("is_active", true)
    .order("id");
  const categories = data ?? [];

  return (
    <main dir="rtl" className="min-h-screen bg-neutral-950 text-white">
      <header className="border-b border-[#39FF14]/20 bg-neutral-950/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <Link href="/" className="flex items-center gap-3">
            <Logo size={38} />
            <h1 className="text-xl font-bold text-[#39FF14] drop-shadow-[0_0_8px_#39FF14]">
              نقشه ماشین من
            </h1>
          </Link>
          <Link
            href="/"
            className="rounded-full border border-[#39FF14]/40 px-4 py-2 text-sm font-bold text-[#39FF14] transition hover:bg-[#39FF14]/10"
          >
            بازگشت به خانه
          </Link>
        </div>
      </header>
      <MapView categories={categories} />
    </main>
  );
}
