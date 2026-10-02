"use client";
import { getCurrentUserId, useIdentity } from "@/lib/auth-client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { AvatarPicker } from "@/components/AvatarPicker";
import {
  AddressForm,
  AddressData,
  emptyAddress,
} from "@/components/AddressForm";
import { supabase } from "@/lib/supabase";
import {
  carBrands,
  getModelsByBrand,
  getTrimsByModel,
  getYearsByTrim,
} from "@/data/cars";
import { provincesData } from "@/data/cities";
import {
  validateProfileForm,
  isValid as isFormValid,
  type FieldErrors,
} from "@/lib/profile-validation";

const fuelTypes = ["بنزین", "دوگانه‌سوز", "دیزل", "برقی", "هیبرید"];

const sellerSpecialties = [
  "موتور و گیربکس",
  "برقی",
  "بدنه",
  "مصرفی و مکمل‌ها",
  "لوازم جانبی و لوکس اسپرت",
  "لوازم افتر مارکت",
];

const sellerTypes = ["خرده‌فروشی", "عمده‌فروشی", "هر دو"];

const serviceCategories = [
  { id: "engine-transmission", title: "تعمیرات موتور و گیربکس", icon: "🔧", items: ["تعمیرات موتور", "گیربکس دستی", "گیربکس اتوماتیک", "پلوس و گاردن و بلبرینگ‌ها", "تعویض لنت"] },
  { id: "suspension", title: "تعمیرات سیستم تعلیق", icon: "🛠️", items: ["جلوبندی", "اکسل عقب", "جعبه فرمان هیدرولیک", "پلوس و گاردن و بلبرینگ‌ها", "تنظیم فرمان دیجیتال", "تنظیم ارتفاع", "تعویض لنت"] },
  { id: "electrical", title: "تعمیرات سیستم برق", icon: "⚡", items: ["برق انژکتور", "برق خودرو", "برق خودروهای هیبریدی", "استارت و دینام", "تعمیرات ECU و بردهای خودرو"] },
  { id: "diagnostic", title: "دیاگ", icon: "💻", items: ["رفع خطا و عیب‌یابی پارامترها", "دانلود و برنامه‌ریزی ایسیو موتور و گیربکس", "عیب‌یابی مالتی‌پلکس", "ایسیوهای استندلون", "انواع ریست و کالیبراسیون سیستم‌های خودرو"] },
  { id: "oil-change", title: "تعویض روغنی", icon: "🛢️", items: ["تعویض روغن موتور با دستگاه", "تعویض روغن گیربکس با دستگاه", "تعویض روغن ترمز با دستگاه", "شستشوی سیستم خنک‌کاری با دستگاه", "تنظیم باد دیجیتال"] },
  { id: "bodywork", title: "صافکاری", icon: "🔨", items: ["سنتی", "پی‌دی‌آر (PDR)", "شاسی‌کشی"] },
  { id: "painting", title: "نقاشی", icon: "🎨", items: ["سنتی", "اتاق رنگ", "لیسه‌گیری", "واکس و پولیش", "سرامیک بدنه"] },
  { id: "car-wash", title: "کارواش", icon: "💧", items: ["سنتی", "اتوماتیک", "صفرشویی", "موتورشویی", "زیرشویی", "جاروبرقی"] },
  { id: "brake", title: "تعمیرات سیستم ترمز", icon: "🛑", items: ["تعمیرات ABS", "تعمیر پمپ و بوستر", "تعویض لنت"] },
  { id: "detailing", title: "دیتیلینگ", icon: "✨", items: ["واکس و پولیش", "سرامیک بدنه", "شیشه دودی", "صفرشویی تخصصی", "کاور بدنه"] },
  { id: "glass-lock", title: "شیشه، بالا بر، قفل و دزدگیر", icon: "🔐", items: ["تعویض شیشه‌ها", "تعمیرات بالابر برقی و دستی", "تعمیرات قفل", "کپی ریموت", "ساخت کلید", "نصب دزدگیر", "تعمیرات دزدگیر"] },
  { id: "audio", title: "سیستم صوتی خودرو", icon: "🔊", items: ["فروش و نصب", "تعمیر سیستم صوتی", "تنظیم سیستم صوتی"] },
  { id: "ac-hydraulic", title: "کولر و هیدرولیک", icon: "❄️", items: ["تعمیرات کولر و کمپرسور کولر خودرو", "شارژ گاز کولر", "تعمیرات جعبه فرمان هیدرولیک", "تعمیرات پمپ هیدرولیک", "تعمیرات جعبه فرمان برقی"] },
  { id: "repair-complex", title: "مجتمع تعمیرگاهی", icon: "🏢", items: ["تعمیرات موتور و گیربکس", "تعمیرات سیستم تعلیق", "تعمیرات سیستم برق", "دیاگ", "تعویض روغنی", "صافکاری", "نقاشی", "کارواش", "تعمیرات سیستم ترمز", "دیتیلینگ", "شیشه، بالا بر، قفل و دزدگیر", "سیستم صوتی خودرو", "کولر و هیدرولیک"] },
];

const rescueTypes = ["باتری", "مکانیک عمومی", "یدک‌کش و خودروبر", "لاستیک", "سوخت"];
const rescueVehicles = ["موتورسیکلت", "وانت", "کامیونت", "کشنده"];
const weekDays = ["شنبه", "یک‌شنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];

function SectionTitle({ children, optional, hint, star }: { children: React.ReactNode; optional?: boolean; hint?: string; star?: boolean }) {
  return (
    <label className="mb-3 block text-sm font-bold text-gray-300">
      {star && <span className="ml-1 text-yellow-400">⭐</span>}
      {children}
      {optional && <span className="mr-2 text-xs font-normal text-gray-500">(اختیاری)</span>}
      {hint && <span className="mt-1 block text-xs font-normal text-gray-500">{hint}</span>}
    </label>
  );
}

function FieldError({ error }: { error?: string }) {
  if (!error) return null;
  return <p className="mt-1.5 text-xs text-red-400">⚠ {error}</p>;
}

function TextInput({ label, value, onChange, placeholder, optional, hint, star, ltr, maxLength, digitsOnly, error }: any) {
  return (
    <div>
      <SectionTitle optional={optional} hint={hint} star={star}>{label}</SectionTitle>
      <input
        type="text"
        value={value || ""}
        onChange={(e) => onChange(digitsOnly ? e.target.value.replace(/\D/g, "") : e.target.value)}
        placeholder={placeholder}
        dir={ltr ? "ltr" : "rtl"}
        maxLength={maxLength}
        aria-invalid={!!error}
        className={`w-full rounded-lg border bg-neutral-950 px-4 py-3 text-white outline-none transition placeholder:text-gray-600 ${
          error ? "border-red-500/60 focus:border-red-500" : "border-[#39FF14]/20 focus:border-[#39FF14]"
        } ${ltr ? "text-left" : ""}`}
      />
      <FieldError error={error} />
    </div>
  );
}

function TextArea({ label, value, onChange, placeholder, optional, hint, rows = 4 }: any) {
  return (
    <div>
      <SectionTitle optional={optional} hint={hint}>{label}</SectionTitle>
      <textarea
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full resize-none rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-white outline-none transition placeholder:text-gray-600 focus:border-[#39FF14]"
      />
    </div>
  );
}

function ChipSelector({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`rounded-full border px-4 py-2 text-sm transition ${
            value === opt
              ? "border-[#39FF14] bg-[#39FF14] font-bold text-black shadow-[0_0_15px_rgba(57,255,20,0.5)]"
              : "border-[#39FF14]/20 text-gray-300 hover:border-[#39FF14]/60"
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function MultiChipSelector({ options, values, onToggle }: { options: string[]; values: string[]; onToggle: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = values.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onToggle(opt)}
            className={`rounded-full border px-4 py-2 text-sm transition ${
              active
                ? "border-[#39FF14] bg-[#39FF14] font-bold text-black shadow-[0_0_15px_rgba(57,255,20,0.5)]"
                : "border-[#39FF14]/20 text-gray-300 hover:border-[#39FF14]/60"
            }`}
          >
            {active && "✓ "}
            {opt}
          </button>
        );
      })}
    </div>
  );
}

function ContactInfo({ value, onChange, errors }: any) {
  const v = value || {};
  const e = errors || {};
  return (
    <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/40 p-6">
      <h3 className="mb-5 text-base font-bold text-[#39FF14]">📞 اطلاعات تماس</h3>
      <div className="space-y-4">
        <TextInput label="شماره تماس اصلی" value={v.phone1 || ""} onChange={(val: string) => onChange({ ...v, phone1: val })} placeholder="09xxxxxxxxx" ltr maxLength={11} digitsOnly error={e.phone1} />
        <TextInput label="شماره تماس دوم" value={v.phone2 || ""} onChange={(val: string) => onChange({ ...v, phone2: val })} placeholder="09xxxxxxxxx" optional ltr maxLength={11} digitsOnly error={e.phone2} />
      </div>
    </div>
  );
}

function WorkingHours({ value, onChange }: any) {
  const v = value || { allTime: false, days: {} };
  const hours = v.days || {};

  const toggleDay = (day: string) => {
    const current = hours[day] || { open: "09:00", close: "19:00", closed: false };
    onChange({ ...v, days: { ...hours, [day]: { ...current, closed: !current.closed } } });
  };

  const updateTime = (day: string, field: "open" | "close", val: string) => {
    const current = hours[day] || { open: "09:00", close: "19:00", closed: false };
    onChange({ ...v, days: { ...hours, [day]: { ...current, [field]: val } } });
  };

  return (
    <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/40 p-6">
      <div className="mb-5 flex items-center justify-between">
        <h3 className="text-base font-bold text-[#39FF14]">🕐 ساعات کاری</h3>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-300">
          <input type="checkbox" checked={v.allTime || false} onChange={(e) => onChange({ ...v, allTime: e.target.checked })} className="h-4 w-4 accent-[#39FF14]" />
          ۲۴ ساعته
        </label>
      </div>
      {!v.allTime && (
        <div className="space-y-2">
          {weekDays.map((day) => {
            const d = hours[day] || { open: "09:00", close: "19:00", closed: false };
            return (
              <div key={day} className="flex items-center gap-3 rounded-lg border border-[#39FF14]/10 bg-neutral-950/50 px-3 py-2">
                <button type="button" onClick={() => toggleDay(day)} className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 ${!d.closed ? "border-[#39FF14] bg-[#39FF14] text-black" : "border-[#39FF14]/40"}`}>
                  {!d.closed && <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><path d="M20 6 9 17l-5-5" /></svg>}
                </button>
                <span className="w-20 text-sm text-gray-200">{day}</span>
                {d.closed ? (
                  <span className="text-xs text-red-400">تعطیل</span>
                ) : (
                  <div className="flex flex-1 items-center gap-2">
                    <input type="time" value={d.open} onChange={(e) => updateTime(day, "open", e.target.value)} className="rounded border border-[#39FF14]/20 bg-neutral-900 px-2 py-1 text-xs text-white" />
                    <span className="text-xs text-gray-500">تا</span>
                    <input type="time" value={d.close} onChange={(e) => updateTime(day, "close", e.target.value)} className="rounded border border-[#39FF14]/20 bg-neutral-900 px-2 py-1 text-xs text-white" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SocialLinks({ value, onChange }: any) {
  const v = value || {};
  return (
    <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/40 p-6">
      <h3 className="mb-5 text-base font-bold text-[#39FF14]">🔗 شبکه‌های اجتماعی</h3>
      <div className="space-y-4">
        <TextInput label="واتساپ" value={v.whatsapp || ""} onChange={(val: string) => onChange({ ...v, whatsapp: val })} placeholder="09xxxxxxxxx" optional ltr />
        <TextInput label="اینستاگرام" value={v.instagram || ""} onChange={(val: string) => onChange({ ...v, instagram: val })} placeholder="@username" optional ltr />
        <TextInput label="تلگرام" value={v.telegram || ""} onChange={(val: string) => onChange({ ...v, telegram: val })} placeholder="@username" optional ltr />
      </div>
    </div>
  );
}

function CarSelector({ value, onChange, errors }: any) {
  const v = value || {};
  const e = errors || {};
  const set = (k: string, val: any) => onChange({ ...v, [k]: val });

  const models = v.brandId ? getModelsByBrand(v.brandId) : [];
  const trims = v.brandId && v.modelId ? getTrimsByModel(v.brandId, v.modelId) : [];
  const years = v.brandId && v.modelId && v.trimId ? getYearsByTrim(v.brandId, v.modelId, v.trimId) : [];

  const brand = carBrands.find((b) => b.id === v.brandId);
  const model = models.find((m) => m.id === v.modelId);
  const trim = trims.find((t) => t.id === v.trimId);

  const availableBrands = carBrands.filter((b) => ["iranian", "chinese", "foreign"].includes(b.category));
  const formatNumber = (n: string) => (n ? Number(n).toLocaleString("fa-IR") : "");

  return (
    <>
      {(brand || model || trim || v.year) && (
        <div className="rounded-xl border border-[#39FF14]/30 bg-[#39FF14]/5 p-4">
          <p className="mb-1 text-xs text-gray-400">خودروی انتخابی شما:</p>
          <p className="text-lg font-bold text-[#39FF14]">
            {[brand?.name, model?.name, trim?.name, v.year && `سال ${v.year}`].filter(Boolean).join(" — ")}
          </p>
        </div>
      )}

      <div>
        <SectionTitle>۱. برند خودرو</SectionTitle>
        <div className="max-h-52 overflow-y-auto rounded-lg border border-[#39FF14]/10 p-3">
          <div className="flex flex-wrap gap-2">
            {availableBrands.map((b) => (
              <button key={b.id} type="button" onClick={() => onChange({ brandId: b.id, modelId: "", trimId: "", year: "", fuel: v.fuel, plate: v.plate, vin: v.vin, mileage: v.mileage })} className={`rounded-full border px-4 py-2 text-sm transition ${v.brandId === b.id ? "border-[#39FF14] bg-[#39FF14] font-bold text-black" : "border-[#39FF14]/20 text-gray-300 hover:border-[#39FF14]/60"}`}>
                {b.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {v.brandId && models.length > 0 && (
        <div>
          <SectionTitle>۲. مدل خودرو</SectionTitle>
          <div className="max-h-52 overflow-y-auto rounded-lg border border-[#39FF14]/10 p-3">
            <div className="flex flex-wrap gap-2">
              {models.map((m) => (
                <button key={m.id} type="button" onClick={() => onChange({ ...v, modelId: m.id, trimId: "", year: "" })} className={`rounded-full border px-4 py-2 text-sm transition ${v.modelId === m.id ? "border-[#39FF14] bg-[#39FF14] font-bold text-black" : "border-[#39FF14]/20 text-gray-300 hover:border-[#39FF14]/60"}`}>
                  {m.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {v.modelId && trims.length > 0 && (
        <div>
          <SectionTitle>۳. تیپ</SectionTitle>
          <div className="max-h-52 overflow-y-auto rounded-lg border border-[#39FF14]/10 p-3">
            <div className="flex flex-wrap gap-2">
              {trims.map((t) => (
                <button key={t.id} type="button" onClick={() => onChange({ ...v, trimId: t.id, year: "" })} className={`rounded-full border px-4 py-2 text-sm transition ${v.trimId === t.id ? "border-[#39FF14] bg-[#39FF14] font-bold text-black" : "border-[#39FF14]/20 text-gray-300 hover:border-[#39FF14]/60"}`}>
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {v.trimId && years.length > 0 && (
        <div>
          <SectionTitle>۴. سال ساخت</SectionTitle>
          <div className="max-h-52 overflow-y-auto rounded-lg border border-[#39FF14]/10 p-3">
            <div className="flex flex-wrap gap-2">
              {years.map((y) => (
                <button key={y} type="button" onClick={() => set("year", String(y))} className={`min-w-[72px] rounded-full border px-4 py-2 text-sm transition ${v.year === String(y) ? "border-[#39FF14] bg-[#39FF14] font-bold text-black" : "border-[#39FF14]/20 text-gray-300 hover:border-[#39FF14]/60"}`}>
                  {y}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {v.year && (
        <div>
          <SectionTitle>نوع سوخت</SectionTitle>
          <ChipSelector options={fuelTypes} value={v.fuel || ""} onChange={(val: string) => set("fuel", val)} />
        </div>
      )}

      {v.year && (
        <div className="space-y-4">
          <TextInput label="کیلومتر کارکرد" value={v.mileage || ""} onChange={(val: string) => set("mileage", val)} placeholder="مثلاً 85000" hint="برای یادآوری سرویس‌های دوره‌ای" optional ltr maxLength={7} digitsOnly error={e.mileage} />
          {v.mileage && Number(v.mileage) > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-[#39FF14]/20 bg-neutral-900/50 px-3 py-2 text-xs text-gray-400">
              <span className="text-[#39FF14]">📍</span>
              <span>کیلومتر فعلی:</span>
              <span className="font-bold text-[#39FF14]">{formatNumber(v.mileage)} کیلومتر</span>
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <TextInput label="شماره پلاک" value={v.plate || ""} onChange={(val: string) => set("plate", val)} placeholder="۱۲ الف ۳۴۵ ایران ۱۱" optional />
            <TextInput label="شماره شاسی (VIN)" value={v.vin || ""} onChange={(val: string) => set("vin", val)} placeholder="17 کاراکتر" optional ltr maxLength={17} error={e.vin} />
          </div>
        </div>
      )}
    </>
  );
}

function CarExpertiseSelector({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const selected = value || [];
  const [openBrands, setOpenBrands] = useState<string[]>([]);
  const availableBrands = carBrands.filter((b) => ["iranian", "chinese", "foreign"].includes(b.category));

  const toggleModel = (brandId: string, modelId: string) => {
    const key = `${brandId}:${modelId}`;
    onChange(selected.includes(key) ? selected.filter((x) => x !== key) : [...selected, key]);
  };

  const toggleBrandOpen = (brandId: string) => {
    setOpenBrands((prev) => (prev.includes(brandId) ? prev.filter((x) => x !== brandId) : [...prev, brandId]));
  };

  const selectAllBrand = (brandId: string) => {
    const keys = getModelsByBrand(brandId).map((m) => `${brandId}:${m.id}`);
    onChange([...selected.filter((k) => !k.startsWith(`${brandId}:`)), ...keys]);
  };

  const clearBrand = (brandId: string) => {
    onChange(selected.filter((k) => !k.startsWith(`${brandId}:`)));
  };

  const countForBrand = (brandId: string) => selected.filter((k) => k.startsWith(`${brandId}:`)).length;

  const names = selected.map((key) => {
    const [bId, mId] = key.split(":");
    return carBrands.find((b) => b.id === bId)?.models.find((m) => m.id === mId)?.name || "";
  });

  return (
    <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/40 p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-[#39FF14]">🚗 خودروهای تحت پوشش</h3>
          <p className="mt-1 text-xs text-gray-400">اون خودروهایی که تخصص داری رو تیک بزن</p>
        </div>
        {selected.length > 0 && (
          <div className="rounded-full border border-[#39FF14]/40 bg-[#39FF14]/10 px-3 py-1 text-xs font-bold text-[#39FF14]">
            {selected.length} انتخاب
          </div>
        )}
      </div>

      <div className="space-y-2">
        {availableBrands.map((brand) => {
          const isOpen = openBrands.includes(brand.id);
          const count = countForBrand(brand.id);
          return (
            <div key={brand.id} className="overflow-hidden rounded-xl border border-[#39FF14]/15 bg-neutral-950/50">
              <div className="flex items-center justify-between px-4 py-3">
                <button type="button" onClick={() => toggleBrandOpen(brand.id)} className="flex flex-1 items-center gap-3 text-right">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`shrink-0 transition-transform ${isOpen ? "rotate-90 text-[#39FF14]" : "text-gray-400"}`}>
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                  <span className="font-bold text-gray-200">{brand.name}</span>
                  {count > 0 && <span className="rounded-full bg-[#39FF14]/20 px-2 py-0.5 text-[10px] font-bold text-[#39FF14]">{count}</span>}
                </button>
                <div className="flex gap-2 text-[11px]">
                  <button type="button" onClick={() => selectAllBrand(brand.id)} className="rounded-full border border-[#39FF14]/30 px-3 py-1 text-[#39FF14] hover:bg-[#39FF14]/10">همه</button>
                  {count > 0 && (
                    <button type="button" onClick={() => clearBrand(brand.id)} className="rounded-full border border-red-500/30 px-3 py-1 text-red-400 hover:bg-red-500/10">پاک</button>
                  )}
                </div>
              </div>
              {isOpen && (
                <div className="grid gap-2 border-t border-[#39FF14]/10 bg-neutral-900/30 p-3 sm:grid-cols-2">
                  {brand.models.map((m) => {
                    const active = selected.includes(`${brand.id}:${m.id}`);
                    return (
                      <button key={m.id} type="button" onClick={() => toggleModel(brand.id, m.id)} className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-right text-sm transition ${active ? "border-[#39FF14] bg-[#39FF14]/10 text-[#39FF14]" : "border-[#39FF14]/15 text-gray-300 hover:border-[#39FF14]/50"}`}>
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 ${active ? "border-[#39FF14] bg-[#39FF14] text-black" : "border-[#39FF14]/40"}`}>
                          {active && <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><path d="M20 6 9 17l-5-5" /></svg>}
                        </span>
                        <span className={active ? "font-bold" : ""}>{m.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {selected.length > 0 && (
        <div className="mt-5 rounded-xl border border-[#39FF14]/30 bg-[#39FF14]/5 p-4">
          <p className="mb-2 text-xs font-bold text-[#39FF14]">✓ خودروهای انتخاب‌شده شما:</p>
          <div className="flex flex-wrap gap-1.5">
            {names.map((name, i) => (
              <span key={i} className="rounded-full border border-[#39FF14]/30 bg-neutral-900/60 px-2.5 py-1 text-[11px] text-gray-200">{name}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ServiceExpertiseSelector({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const selected = value || [];
  const [openCategories, setOpenCategories] = useState<string[]>([]);

  const toggleItem = (catId: string, item: string) => {
    const key = `${catId}:${item}`;
    onChange(selected.includes(key) ? selected.filter((x) => x !== key) : [...selected, key]);
  };

  const toggleCategoryOpen = (catId: string) => {
    setOpenCategories((prev) => (prev.includes(catId) ? prev.filter((x) => x !== catId) : [...prev, catId]));
  };

  const selectAllCategory = (catId: string, items: string[]) => {
    const keys = items.map((i) => `${catId}:${i}`);
    onChange([...selected.filter((k) => !k.startsWith(`${catId}:`)), ...keys]);
  };

  const clearCategory = (catId: string) => {
    onChange(selected.filter((k) => !k.startsWith(`${catId}:`)));
  };

  const countForCat = (catId: string) => selected.filter((k) => k.startsWith(`${catId}:`)).length;

  return (
    <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/40 p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-[#39FF14]">🛠️ تخصص‌های خدمات فنی</h3>
          <p className="mt-1 text-xs text-gray-400">هر سرویس رو باز کن و زیرشاخه‌ها رو تیک بزن</p>
        </div>
        {selected.length > 0 && (
          <div className="rounded-full border border-[#39FF14]/40 bg-[#39FF14]/10 px-3 py-1 text-xs font-bold text-[#39FF14]">
            {selected.length} انتخاب
          </div>
        )}
      </div>

      <div className="space-y-3">
        {serviceCategories.map((cat) => {
          const isOpen = openCategories.includes(cat.id);
          const count = countForCat(cat.id);
          return (
            <div key={cat.id} className={`overflow-hidden rounded-xl border transition ${count > 0 ? "border-[#39FF14]/50 bg-[#39FF14]/5" : "border-[#39FF14]/15 bg-neutral-950/50"}`}>
              <div className="flex items-center justify-between px-4 py-3">
                <button type="button" onClick={() => toggleCategoryOpen(cat.id)} className="flex flex-1 items-center gap-3 text-right">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`shrink-0 transition-transform ${isOpen ? "rotate-90 text-[#39FF14]" : "text-gray-400"}`}>
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                  <span className="text-xl">{cat.icon}</span>
                  <span className={`font-bold ${count > 0 ? "text-[#39FF14]" : "text-gray-200"}`}>{cat.title}</span>
                  {count > 0 && <span className="rounded-full bg-[#39FF14] px-2 py-0.5 text-[10px] font-bold text-black">{count}</span>}
                </button>
                <div className="flex gap-2 text-[11px]">
                  <button type="button" onClick={() => selectAllCategory(cat.id, cat.items)} className="rounded-full border border-[#39FF14]/30 px-3 py-1 text-[#39FF14] hover:bg-[#39FF14]/10">همه</button>
                  {count > 0 && (
                    <button type="button" onClick={() => clearCategory(cat.id)} className="rounded-full border border-red-500/30 px-3 py-1 text-red-400 hover:bg-red-500/10">پاک</button>
                  )}
                </div>
              </div>
              {isOpen && (
                <div className="grid gap-2 border-t border-[#39FF14]/10 bg-neutral-900/30 p-3 sm:grid-cols-2">
                  {cat.items.map((item) => {
                    const active = selected.includes(`${cat.id}:${item}`);
                    return (
                      <button key={item} type="button" onClick={() => toggleItem(cat.id, item)} className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-right text-sm transition ${active ? "border-[#39FF14] bg-[#39FF14]/10 text-[#39FF14]" : "border-[#39FF14]/15 text-gray-300 hover:border-[#39FF14]/50"}`}>
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 ${active ? "border-[#39FF14] bg-[#39FF14] text-black" : "border-[#39FF14]/40"}`}>
                          {active && <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><path d="M20 6 9 17l-5-5" /></svg>}
                        </span>
                        <span className={active ? "font-bold" : ""}>{item}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OwnerForm({ carData, setCarData, addressData, setAddressData, contact, setContact, errors }: any) {
  const e = errors || {};
  return (
    <>
      <CarSelector value={carData} onChange={setCarData} errors={e} />
      <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/40 p-6">
        <h3 className="mb-5 text-base font-bold text-[#39FF14]">📍 آدرس</h3>
        <AddressForm value={addressData} onChange={setAddressData} errors={e} />
      </div>
      <ContactInfo value={contact} onChange={setContact} errors={e} />
    </>
  );
}

function SellerForm({ sellerData, setSellerData, addressData, setAddressData, contact, setContact, workingHours, setWorkingHours, socialLinks, setSocialLinks, carExpertise, setCarExpertise, about, setAbout, errors }: any) {
  const e = errors || {};
  return (
    <>
      <TextInput label="نام فروشگاه" value={sellerData.shopName || ""} onChange={(v: string) => setSellerData({ ...sellerData, shopName: v })} placeholder="مثلاً فروشگاه برق خودرو مهدی" />

      <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/40 p-6">
        <h3 className="mb-5 text-base font-bold text-[#39FF14]">📍 آدرس فروشگاه</h3>
        <AddressForm value={addressData} onChange={setAddressData} errors={e} />
      </div>

      <WorkingHours value={workingHours} onChange={setWorkingHours} />
      <ContactInfo value={contact} onChange={setContact} errors={e} />

      <div>
        <SectionTitle>حوزه تخصص (چند انتخابی)</SectionTitle>
        <MultiChipSelector options={sellerSpecialties} values={sellerData.specialties || []} onToggle={(s: string) => {
          const prev = sellerData.specialties || [];
          setSellerData({ ...sellerData, specialties: prev.includes(s) ? prev.filter((x: string) => x !== s) : [...prev, s] });
        }} />
      </div>

      <div>
        <SectionTitle>نوع فروش</SectionTitle>
        <ChipSelector options={sellerTypes} value={sellerData.saleType || ""} onChange={(v: string) => setSellerData({ ...sellerData, saleType: v })} />
      </div>

      <TextInput label="حداقل مبلغ سفارش (تومان)" value={sellerData.minOrder || ""} onChange={(v: string) => setSellerData({ ...sellerData, minOrder: v })} placeholder="مثلاً 500000" optional ltr digitsOnly hint="خالی بگذارید = بدون محدودیت" />

      <CarExpertiseSelector value={carExpertise} onChange={setCarExpertise} />

      <TextArea label="درباره فروشگاه" value={about} onChange={setAbout} placeholder="معرفی کوتاه" optional />

      <SocialLinks value={socialLinks} onChange={setSocialLinks} />
    </>
  );
}

function ServiceForm({ sellerData, setSellerData, addressData, setAddressData, contact, setContact, workingHours, setWorkingHours, socialLinks, setSocialLinks, carExpertise, setCarExpertise, serviceExpertise, setServiceExpertise, about, setAbout, errors }: any) {
  const e = errors || {};
  return (
    <>
      <TextInput
        label="نام تعمیرگاه یا مجتمع"
        value={sellerData.shopName || ""}
        onChange={(v: string) => setSellerData({ ...sellerData, shopName: v })}
        placeholder="نام کارگاه"
        optional
      />

      <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/40 p-6">
        <h3 className="mb-5 text-base font-bold text-[#39FF14]">📍 آدرس محل کار</h3>
        <AddressForm value={addressData} onChange={setAddressData} errors={e} />
      </div>

      <WorkingHours value={workingHours} onChange={setWorkingHours} />
      <ContactInfo value={contact} onChange={setContact} errors={e} />

      <ServiceExpertiseSelector value={serviceExpertise} onChange={setServiceExpertise} />

      <CarExpertiseSelector value={carExpertise} onChange={setCarExpertise} />

      <TextInput label="سال سابقه کار" value={sellerData.experience || ""} onChange={(v: string) => setSellerData({ ...sellerData, experience: v })} placeholder="مثلاً 15" ltr maxLength={2} digitsOnly error={e.experience} />

      <TextInput label="گارانتی خدمات (ماه)" value={sellerData.warranty || ""} onChange={(v: string) => setSellerData({ ...sellerData, warranty: v })} placeholder="مثلاً 6" optional ltr maxLength={2} digitsOnly error={e.warranty} />

      <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/40 p-6">
        <h3 className="mb-4 text-base font-bold text-[#39FF14]">🚙 خدمات سیار</h3>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-200">
          <input type="checkbox" checked={sellerData.mobileService || false} onChange={(e) => setSellerData({ ...sellerData, mobileService: e.target.checked })} className="h-4 w-4 accent-[#39FF14]" />
          ارائه خدمات در محل مشتری
        </label>
      </div>

      <TextArea label="درباره من / مجموعه" value={about} onChange={setAbout} placeholder="تخصص‌ها، سابقه، نمونه کار" optional />

      <SocialLinks value={socialLinks} onChange={setSocialLinks} />
    </>
  );
}

function RescuerForm({ rescuerData, setRescuerData, addressData, setAddressData, contact, setContact, workingHours, setWorkingHours, socialLinks, setSocialLinks, about, setAbout, errors }: any) {
  const e = errors || {};
  return (
    <>
      <div className="rounded-2xl border border-[#39FF14]/20 bg-neutral-900/40 p-6">
        <h3 className="mb-5 text-base font-bold text-[#39FF14]">📍 آدرس / منطقه فعالیت</h3>
        <AddressForm value={addressData} onChange={setAddressData} errors={e} />
      </div>

      <WorkingHours value={workingHours} onChange={setWorkingHours} />
      <ContactInfo value={contact} onChange={setContact} errors={e} />

      <div>
        <SectionTitle>نوع امداد (چند انتخابی)</SectionTitle>
        <MultiChipSelector options={rescueTypes} values={rescuerData.rescueTypes || []} onToggle={(s: string) => {
          const prev = rescuerData.rescueTypes || [];
          setRescuerData({ ...rescuerData, rescueTypes: prev.includes(s) ? prev.filter((x: string) => x !== s) : [...prev, s] });
        }} />
      </div>

      <div>
        <SectionTitle>وسیله نقلیه امداد</SectionTitle>
        <ChipSelector options={rescueVehicles} value={rescuerData.vehicle || ""} onChange={(v: string) => setRescuerData({ ...rescuerData, vehicle: v })} />
      </div>

      <TextInput label="شعاع سرویس‌دهی (کیلومتر)" value={rescuerData.radius || ""} onChange={(v: string) => setRescuerData({ ...rescuerData, radius: v })} placeholder="مثلاً 30" ltr maxLength={3} digitsOnly error={e.radius} />

      <TextInput label="سال سابقه امدادگری" value={rescuerData.experience || ""} onChange={(v: string) => setRescuerData({ ...rescuerData, experience: v })} placeholder="مثلاً 5" ltr maxLength={2} digitsOnly error={e.experience} />

      <TextArea label="درباره من" value={about} onChange={setAbout} placeholder="معرفی کوتاه" optional />

      <SocialLinks value={socialLinks} onChange={setSocialLinks} />
    </>
  );
}

function buildSnapshot(vals: {
  addressData: any; contact: any; workingHours: any; socialLinks: any; about: string;
  carData: any; carExpertise: string[]; serviceExpertise: string[]; sellerData: any; rescuerData: any;
}) {
  return JSON.stringify(vals);
}

function ProfileContent() {
  const { profile: identityProfile } = useIdentity();
  const router = useRouter();
  const type = identityProfile?.user_type ?? "owner";

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [userId, setUserId] = useState("");
  const [dirty, setDirty] = useState(false);
  const [confirmAction, setConfirmAction] = useState<null | "cancel" | "leave">(null);

  const [addressData, setAddressData] = useState<AddressData>(emptyAddress);
  const [contact, setContact] = useState<any>({});
  const [workingHours, setWorkingHours] = useState<any>({});
  const [socialLinks, setSocialLinks] = useState<any>({});
  const [about, setAbout] = useState("");

  const [carData, setCarData] = useState<any>({});
  const [carExpertise, setCarExpertise] = useState<string[]>([]);
  const [serviceExpertise, setServiceExpertise] = useState<string[]>([]);
  const [sellerData, setSellerData] = useState<any>({});
  const [rescuerData, setRescuerData] = useState<any>({});

  const snapshotRef = useRef<string | null>(null);
  const initialValuesRef = useRef<Parameters<typeof buildSnapshot>[0] | null>(null);

  const currentValues = () => ({
    addressData, contact, workingHours, socialLinks, about,
    carData, carExpertise, serviceExpertise, sellerData, rescuerData,
  });

  const loadProfile = async () => {
    setLoading(true);
    setLoadError(false);
    const storedId = await getCurrentUserId();
    if (!storedId) {
      router.push("/login");
      return;
    }
    setUserId(storedId);

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", storedId)
      .single();

    if (error || !data) {
      setLoadError(true);
      setLoading(false);
      return;
    }

    const extra = data.data || {};
    const loaded = {
      addressData: data.address_data || emptyAddress,
      contact: { phone1: data.phone1, phone2: data.phone2 },
      workingHours: data.working_hours || {},
      socialLinks: data.social_links || {},
      about: data.about || "",
      carData: extra.car || {},
      carExpertise: extra.carExpertise || [],
      serviceExpertise: extra.serviceExpertise || [],
      sellerData: extra.seller || {},
      rescuerData: extra.rescuer || {},
    };

    setAddressData(loaded.addressData);
    setContact(loaded.contact);
    setWorkingHours(loaded.workingHours);
    setSocialLinks(loaded.socialLinks);
    setAbout(loaded.about);
    setCarData(loaded.carData);
    setCarExpertise(loaded.carExpertise);
    setServiceExpertise(loaded.serviceExpertise);
    setSellerData(loaded.sellerData);
    setRescuerData(loaded.rescuerData);

    initialValuesRef.current = loaded;
    snapshotRef.current = buildSnapshot(loaded);
    setDirty(false);
    setFieldErrors({});
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (loading || !snapshotRef.current) return;
    setDirty(buildSnapshot(currentValues()) !== snapshotRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressData, contact, workingHours, socialLinks, about, carData, carExpertise, serviceExpertise, sellerData, rescuerData, loading]);

  const restoreSnapshot = () => {
    const initial = initialValuesRef.current;
    if (!initial) return;
    setAddressData(initial.addressData);
    setContact(initial.contact);
    setWorkingHours(initial.workingHours);
    setSocialLinks(initial.socialLinks);
    setAbout(initial.about);
    setCarData(initial.carData);
    setCarExpertise(initial.carExpertise);
    setServiceExpertise(initial.serviceExpertise);
    setSellerData(initial.sellerData);
    setRescuerData(initial.rescuerData);
    setFieldErrors({});
    setSaveError("");
    setDirty(false);
  };

  const requestCancel = () => {
    if (dirty) setConfirmAction("cancel");
    else restoreSnapshot();
  };

  const requestLeave = () => {
    if (dirty) setConfirmAction("leave");
    else router.push("/dashboard");
  };

  const confirmDiscard = () => {
    if (confirmAction === "cancel") restoreSnapshot();
    if (confirmAction === "leave") router.push("/dashboard");
    setConfirmAction(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError("");

    const errors = validateProfileForm(
      type as any,
      { addressData, contact, carData, sellerData, rescuerData },
      provincesData
    );
    setFieldErrors(errors);
    if (!isFormValid(errors)) {
      setSaveError("لطفاً خطاهای فرم را بررسی و اصلاح کنید");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    setSaving(true);

    const extra: any = {};
    if (type === "owner") extra.car = carData;
    if (type === "seller") { extra.seller = sellerData; extra.carExpertise = carExpertise; }
    if (type === "service") { extra.serviceExpertise = serviceExpertise; extra.carExpertise = carExpertise; extra.seller = sellerData; }
    if (type === "rescuer") extra.rescuer = rescuerData;

    const { error } = await supabase
      .from("profiles")
      .update({
        address_data: addressData,
        phone1: contact.phone1 || null,
        phone2: contact.phone2 || null,
        working_hours: workingHours,
        social_links: socialLinks,
        about: about || null,
        data: extra,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (error) {
      setSaveError(`خطا در ذخیره: ${error.message}`);
      setSaving(false);
      return;
    }

    const savedValues = currentValues();
    initialValuesRef.current = savedValues;
    snapshotRef.current = buildSnapshot(savedValues);
    setDirty(false);
    setSaving(false);
    setSaved(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => setSaved(false), 4000);
  };

  const config: Record<string, { icon: string; title: string }> = {
    owner: { icon: "🚗", title: "صاحب خودرو" },
    seller: { icon: "📦", title: "فروشنده قطعات" },
    service: { icon: "🔧", title: "ارائه‌دهنده خدمات فنی" },
    rescuer: { icon: "🚨", title: "امداد رسان" },
  };
  const current = config[type] || config.owner;

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-gray-400">
        در حال بارگذاری پروفایل...
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-24 text-center">
        <span className="text-5xl">⚠️</span>
        <h2 className="text-xl font-bold text-red-400">پروفایل بارگذاری نشد</h2>
        <p className="text-sm text-gray-400">
          متأسفانه اطلاعات پروفایل شما در دسترس نیست. ممکن است اتصال شما قطع شده باشد یا مشکلی موقت پیش آمده باشد.
        </p>
        <div className="flex w-full flex-col gap-3">
          <button
            type="button"
            onClick={() => loadProfile()}
            className="w-full rounded-lg bg-[#39FF14] px-8 py-3 font-bold text-black shadow-[0_0_20px_rgba(57,255,20,0.5)] transition hover:bg-[#39FF14]/80"
          >
            تلاش دوباره
          </button>
          <Link href="/dashboard" className="block w-full rounded-lg border border-[#39FF14]/30 px-8 py-3 text-center font-bold text-[#39FF14] transition hover:bg-[#39FF14]/10">
            برگشت به پنل کاربری
          </Link>
        </div>
      </div>
    );
  }

  const formProps = { addressData, setAddressData, contact, setContact, workingHours, setWorkingHours, socialLinks, setSocialLinks, about, setAbout, errors: fieldErrors };

  return (
    <section className="mx-auto max-w-3xl px-6 py-12">
      <div className="mb-8 flex items-center gap-4">
        <span className="text-5xl">{current.icon}</span>
        <div>
          <h2 className="text-2xl font-bold md:text-3xl">
            پروفایل <span className="text-[#39FF14]">{current.title}</span>
          </h2>
          <p className="text-gray-400">اطلاعاتت رو کامل کن — هر وقت خواستی می‌تونی ویرایش کنی</p>
        </div>
      </div>

      {saved && (
        <div className="mb-6 flex items-center gap-3 rounded-lg border border-[#39FF14]/40 bg-[#39FF14]/10 px-4 py-3 text-sm text-[#39FF14] shadow-[0_0_15px_rgba(57,255,20,0.2)]">
          <span className="text-xl">✅</span>
          <span className="font-bold">اطلاعات پروفایل شما با موفقیت ذخیره شد</span>
        </div>
      )}

      {saveError && (
        <div className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          ❌ {saveError}
        </div>
      )}

      {confirmAction && (
        <div className="mb-6 rounded-2xl border border-yellow-500/40 bg-yellow-500/5 p-5">
          <p className="font-bold text-yellow-400">تغییرات ذخیره‌نشده دارید</p>
          <p className="mt-1 text-sm text-gray-400">
            اگر الان ادامه بدهی، تغییراتی که هنوز ذخیره نکردی از بین می‌رن. مطمئنی؟
          </p>
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={confirmDiscard}
              className="rounded-lg bg-red-500/20 px-5 py-2 text-sm font-bold text-red-400 transition hover:bg-red-500/30"
            >
              بله، تغییرات را نادیده بگیر
            </button>
            <button
              type="button"
              onClick={() => setConfirmAction(null)}
              className="rounded-lg border border-[#39FF14]/30 px-5 py-2 text-sm font-bold text-[#39FF14] transition hover:bg-[#39FF14]/10"
            >
              انصراف، برگرد به ویرایش
            </button>
          </div>
        </div>
      )}

      <div className="mb-8">
        <AvatarPicker />
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {type === "owner" && <OwnerForm carData={carData} setCarData={setCarData} {...formProps} />}
        {type === "seller" && <SellerForm sellerData={sellerData} setSellerData={setSellerData} carExpertise={carExpertise} setCarExpertise={setCarExpertise} {...formProps} />}
        {type === "service" && <ServiceForm sellerData={sellerData} setSellerData={setSellerData} carExpertise={carExpertise} setCarExpertise={setCarExpertise} serviceExpertise={serviceExpertise} setServiceExpertise={setServiceExpertise} {...formProps} />}
        {type === "rescuer" && <RescuerForm rescuerData={rescuerData} setRescuerData={setRescuerData} {...formProps} />}

        <button type="submit" disabled={saving} className="w-full rounded-lg bg-[#39FF14] px-8 py-3 font-bold text-black shadow-[0_0_20px_rgba(57,255,20,0.5)] transition hover:bg-[#39FF14]/80 hover:shadow-[0_0_30px_rgba(57,255,20,0.8)] disabled:cursor-not-allowed disabled:opacity-50">
          {saving ? "در حال ذخیره..." : "ذخیره اطلاعات"}
        </button>

        <button
          type="button"
          onClick={requestCancel}
          disabled={!dirty}
          className="w-full rounded-lg border border-yellow-500/30 px-8 py-3 text-center font-bold text-yellow-400 transition hover:bg-yellow-500/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          انصراف از تغییرات
        </button>

        <button
          type="button"
          onClick={requestLeave}
          className="block w-full rounded-lg border border-[#39FF14]/30 px-8 py-3 text-center font-bold text-[#39FF14] transition hover:bg-[#39FF14]/10"
        >
          برگشت به پنل کاربری
        </button>
      </form>
    </section>
  );
}

export default function ProfilePage() {
  return (
    <main className="min-h-screen bg-neutral-950 text-white" dir="rtl">
      <header className="border-b border-[#39FF14]/20 px-6 py-4">
        <Link href="/" className="mx-auto flex max-w-6xl items-center gap-3">
          <Logo size={36} />
          <h1 className="text-xl font-bold text-[#39FF14] drop-shadow-[0_0_8px_#39FF14]">ماشین من</h1>
        </Link>
      </header>

      <Suspense fallback={<div className="p-10 text-center text-gray-400">در حال بارگذاری...</div>}>
        <ProfileContent />
      </Suspense>
    </main>
  );
}