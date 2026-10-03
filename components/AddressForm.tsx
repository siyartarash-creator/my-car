"use client";

import { provincesData } from "@/data/cities";

export type AddressData = {
  province: string;
  city: string;
  region: string;
  street: string;
  alley: string;
  postal_code: string;
  lat?: number;
  lng?: number;
};

export const emptyAddress: AddressData = {
  province: "",
  city: "",
  region: "",
  street: "",
  alley: "",
  postal_code: "",
};

type AddressFormProps = {
  value: AddressData;
  onChange: (address: AddressData) => void;
  showMap?: boolean;
  errors?: Partial<Record<keyof AddressData, string>>;
};

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1.5 text-xs text-red-400">⚠ {message}</p>;
}

export function AddressForm({
  value,
  onChange,
  showMap = true,
  errors,
}: AddressFormProps) {
  const fieldErrors = errors || {};
  const provinces = Object.keys(provincesData);
  const cities = value.province ? provincesData[value.province] || [] : [];

  const set = (field: keyof AddressData, val: string | number) => {
    onChange({ ...value, [field]: val });
  };

  const handleProvinceChange = (province: string) => {
    onChange({ ...value, province, city: "" });
  };

  const handleGetLocation = () => {
    if (!navigator.geolocation) {
      alert("مرورگر شما از موقعیت‌یابی پشتیبانی نمی‌کند");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onChange({
          ...value,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      (err) => {
        alert(`خطا در دریافت موقعیت: ${err.message}`);
      }
    );
  };

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-1.5 text-[11px] leading-5 text-gray-500">
        <span>🔒</span>
        <span>آدرس دقیق شما خصوصی است و فقط برای خودتان و مدیران سیستم نمایش داده می‌شود.</span>
      </p>

      {/* استان + شهر */}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-2 block text-sm font-bold text-gray-300">
            استان *
          </label>
          <select
            value={value.province}
            onChange={(e) => handleProvinceChange(e.target.value)}
            className={`w-full rounded-lg border bg-neutral-950 px-4 py-3 text-white outline-none transition ${
              fieldErrors.province ? "border-red-500/60 focus:border-red-500" : "border-[#39FF14]/20 focus:border-[#39FF14]"
            }`}
            required
          >
            <option value="">— انتخاب کن —</option>
            {provinces.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <FieldError message={fieldErrors.province} />
        </div>
        <div>
          <label className="mb-2 block text-sm font-bold text-gray-300">
            شهر *
          </label>
          <select
            value={value.city}
            onChange={(e) => set("city", e.target.value)}
            disabled={!value.province}
            className={`w-full rounded-lg border bg-neutral-950 px-4 py-3 text-white outline-none transition disabled:cursor-not-allowed disabled:opacity-50 ${
              fieldErrors.city ? "border-red-500/60 focus:border-red-500" : "border-[#39FF14]/20 focus:border-[#39FF14]"
            }`}
            required
          >
            <option value="">
              {value.province ? "— انتخاب کن —" : "اول استان رو انتخاب کن"}
            </option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <FieldError message={fieldErrors.city} />
        </div>
      </div>

      {/* منطقه/شهرک */}
      <div>
        <label className="mb-2 block text-sm font-bold text-gray-300">
          منطقه / شهرک
        </label>
        <input
          type="text"
          value={value.region}
          onChange={(e) => set("region", e.target.value)}
          placeholder="مثلاً سعادت‌آباد، شهرک غرب"
          className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-white outline-none transition placeholder:text-gray-600 focus:border-[#39FF14]"
        />
      </div>

      {/* خیابان اصلی + کوچه */}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-2 block text-sm font-bold text-gray-300">
            خیابان اصلی *
          </label>
          <input
            type="text"
            value={value.street}
            onChange={(e) => set("street", e.target.value)}
            placeholder="مثلاً خیابان ولیعصر"
            className={`w-full rounded-lg border bg-neutral-950 px-4 py-3 text-white outline-none transition placeholder:text-gray-600 ${
              fieldErrors.street ? "border-red-500/60 focus:border-red-500" : "border-[#39FF14]/20 focus:border-[#39FF14]"
            }`}
            required
          />
          <FieldError message={fieldErrors.street} />
        </div>
        <div>
          <label className="mb-2 block text-sm font-bold text-gray-300">
            کوچه / پلاک / واحد
          </label>
          <input
            type="text"
            value={value.alley}
            onChange={(e) => set("alley", e.target.value)}
            placeholder="مثلاً کوچه بهار، پلاک ۱۲، واحد ۳"
            className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-white outline-none transition placeholder:text-gray-600 focus:border-[#39FF14]"
          />
        </div>
      </div>

      {/* کد پستی */}
      <div>
        <label className="mb-2 block text-sm font-bold text-gray-300">
          کد پستی
        </label>
        <input
          type="text"
          value={value.postal_code}
          onChange={(e) =>
            set("postal_code", e.target.value.replace(/\D/g, "").slice(0, 10))
          }
          placeholder="۱۰ رقم"
          dir="ltr"
          className={`w-full rounded-lg border bg-neutral-950 px-4 py-3 text-left text-white outline-none transition placeholder:text-gray-600 ${
            fieldErrors.postal_code ? "border-red-500/60 focus:border-red-500" : "border-[#39FF14]/20 focus:border-[#39FF14]"
          }`}
        />
        <FieldError message={fieldErrors.postal_code} />
      </div>

      {/* موقعیت مکانی */}
      {showMap && (
        <div>
          <label className="mb-2 block text-sm font-bold text-gray-300">
            موقعیت مکانی{" "}
            <span className="text-xs font-normal text-gray-500">(اختیاری)</span>
          </label>
          {value.lat && value.lng ? (
            <div className="flex items-center gap-3 rounded-lg border border-[#39FF14]/40 bg-[#39FF14]/5 p-4">
              <span className="text-2xl">📍</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-[#39FF14]">
                  موقعیت ثبت شد
                </p>
                <p className="mt-0.5 text-xs text-gray-400" dir="ltr">
                  {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  onChange({ ...value, lat: undefined, lng: undefined });
                }}
                className="text-xs text-red-400 transition hover:text-red-300"
              >
                حذف
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleGetLocation}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[#39FF14]/40 py-4 text-sm text-gray-400 transition hover:border-[#39FF14] hover:bg-[#39FF14]/5 hover:text-[#39FF14]"
            >
              📍 دریافت موقعیت من
            </button>
          )}
        </div>
      )}
    </div>
  );
}