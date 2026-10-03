// Deterministic, dependency-free profile completeness scoring for the unified
// /profile system. Single source of truth for "is this profile usefully
// filled in" — supersedes the inline getMissingFields() previously duplicated
// in ProfileStatusCard, and is also consumed by the /profile self-view.
//
// Scoring reflects real usefulness, not gamification: required items are the
// minimum for a credible profile per role (mirrors the Phase 1 completion
// criteria); optional items are additional fields that make the profile more
// useful but are never blocking.

export type ProfileType = "owner" | "seller" | "service" | "rescuer";

export type CompletenessProfile = {
  address_data?: { province?: string; city?: string; street?: string } | null;
  phone1?: string | null;
  about?: string | null;
  working_hours?: { allTime?: boolean; days?: Record<string, { closed?: boolean }> } | null;
  social_links?: Record<string, string> | null;
  data?: {
    car?: {
      brandId?: string;
      modelId?: string;
      year?: string;
      displayName?: string;
      photoUrl?: string | null;
      mileage?: string;
    } | null;
    seller?: {
      shopName?: string;
      specialties?: string[];
      saleType?: string;
      photoUrl?: string | null;
      experience?: string;
      about?: string;
    } | null;
    serviceExpertise?: string[] | null;
    carExpertise?: string[] | null;
    rescuer?: {
      rescueTypes?: string[];
      vehicle?: string;
      radius?: string;
      experience?: string;
    } | null;
  } | null;
};

export type CompletenessItem = { key: string; label: string };

export type CompletenessResult = {
  percent: number;
  done: number;
  total: number;
  missingRequired: CompletenessItem[];
  missingOptional: CompletenessItem[];
};

function hasWorkingHours(wh: CompletenessProfile["working_hours"]): boolean {
  if (!wh) return false;
  if (wh.allTime) return true;
  const days = wh.days || {};
  return Object.values(days).some((d) => !d?.closed);
}

function hasAnySocial(links: CompletenessProfile["social_links"]): boolean {
  if (!links) return false;
  return Object.values(links).some((v) => !!v && String(v).trim().length > 0);
}

function trimmed(v: string | null | undefined): string {
  return (v || "").trim();
}

function scored(items: { key: string; label: string; required: boolean; present: boolean }[]): CompletenessResult {
  const done = items.filter((i) => i.present).length;
  const total = items.length;
  return {
    percent: total === 0 ? 100 : Math.round((done / total) * 100),
    done,
    total,
    missingRequired: items.filter((i) => i.required && !i.present).map((i) => ({ key: i.key, label: i.label })),
    missingOptional: items.filter((i) => !i.required && !i.present).map((i) => ({ key: i.key, label: i.label })),
  };
}

export function getProfileCompleteness(
  profile: CompletenessProfile,
  type: ProfileType
): CompletenessResult {
  const addr = profile.address_data;
  const data = profile.data || {};

  const core = [
    { key: "address.province", label: "استان", required: true, present: !!trimmed(addr?.province) },
    { key: "address.city", label: "شهر", required: true, present: !!trimmed(addr?.city) },
    { key: "address.street", label: "خیابان", required: true, present: !!trimmed(addr?.street) },
    { key: "phone1", label: "شماره تماس", required: true, present: !!trimmed(profile.phone1) },
  ];

  let roleItems: { key: string; label: string; required: boolean; present: boolean }[] = [];

  if (type === "owner") {
    const car = data.car || {};
    roleItems = [
      { key: "car.brandId", label: "برند خودرو", required: true, present: !!car.brandId },
      { key: "car.modelId", label: "مدل خودرو", required: true, present: !!car.modelId },
      { key: "car.year", label: "سال ساخت", required: false, present: !!car.year },
      { key: "car.displayName", label: "نام دلخواه خودرو", required: false, present: !!trimmed(car.displayName) },
      { key: "car.photoUrl", label: "عکس خودرو", required: false, present: !!car.photoUrl },
      { key: "car.mileage", label: "کیلومتر کارکرد", required: false, present: !!trimmed(car.mileage) },
    ];
  } else if (type === "seller") {
    const seller = data.seller || {};
    roleItems = [
      { key: "seller.shopName", label: "نام فروشگاه", required: true, present: !!trimmed(seller.shopName) },
      {
        key: "seller.specialties",
        label: "حوزه تخصص",
        required: true,
        present: !!seller.specialties?.length,
      },
      { key: "seller.saleType", label: "نوع فروش", required: false, present: !!seller.saleType },
      {
        key: "carExpertise",
        label: "خودروهای تحت پوشش",
        required: false,
        present: !!data.carExpertise?.length,
      },
      { key: "about", label: "درباره فروشگاه", required: false, present: !!trimmed(profile.about) },
      { key: "working_hours", label: "ساعات کاری", required: false, present: hasWorkingHours(profile.working_hours) },
      { key: "social_links", label: "شبکه‌های اجتماعی", required: false, present: hasAnySocial(profile.social_links) },
    ];
  } else if (type === "service") {
    const seller = data.seller || {};
    roleItems = [
      {
        key: "serviceExpertise",
        label: "نوع خدمات",
        required: true,
        present: !!data.serviceExpertise?.length,
      },
      {
        key: "carExpertise",
        label: "خودروهای تحت پوشش",
        required: false,
        present: !!data.carExpertise?.length,
      },
      { key: "seller.experience", label: "سال سابقه کار", required: false, present: !!trimmed(seller.experience) },
      { key: "seller.photoUrl", label: "عکس تعمیرگاه", required: false, present: !!seller.photoUrl },
      { key: "about", label: "درباره من / مجموعه", required: false, present: !!trimmed(profile.about) },
      { key: "working_hours", label: "ساعات کاری", required: false, present: hasWorkingHours(profile.working_hours) },
    ];
  } else if (type === "rescuer") {
    const rescuer = data.rescuer || {};
    roleItems = [
      {
        key: "rescuer.rescueTypes",
        label: "نوع امداد",
        required: true,
        present: !!rescuer.rescueTypes?.length,
      },
      { key: "rescuer.vehicle", label: "وسیله نقلیه امداد", required: false, present: !!rescuer.vehicle },
      { key: "rescuer.radius", label: "شعاع سرویس‌دهی", required: false, present: !!trimmed(rescuer.radius) },
      { key: "rescuer.experience", label: "سال سابقه امدادگری", required: false, present: !!trimmed(rescuer.experience) },
      { key: "about", label: "درباره من", required: false, present: !!trimmed(profile.about) },
      { key: "working_hours", label: "ساعات کاری", required: false, present: hasWorkingHours(profile.working_hours) },
    ];
  }

  return scored([...core, ...roleItems]);
}
