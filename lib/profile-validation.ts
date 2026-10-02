// Deterministic, dependency-free validation for the unified /profile form.
// Mirrors the formats already established elsewhere in the repo (mobile regex
// matches the signup trigger in supabase/migrations/202609290001_security_foundation.sql)
// rather than inventing new policy.

export type FieldErrors = Record<string, string>;

const MOBILE_RE = /^09[0-9]{9}$/;

export function validateAddress(
  addr: { province?: string; city?: string; street?: string; postal_code?: string } | null | undefined,
  provincesData: Record<string, string[]>
): FieldErrors {
  const errors: FieldErrors = {};
  const province = addr?.province?.trim() || "";
  const city = addr?.city?.trim() || "";
  const street = addr?.street?.trim() || "";
  const postalCode = addr?.postal_code?.trim() || "";

  if (!province) errors.province = "استان را انتخاب کنید";
  else if (!Object.hasOwn(provincesData, province)) errors.province = "استان انتخاب‌شده معتبر نیست";

  if (!city) errors.city = "شهر را انتخاب کنید";
  else if (province && Object.hasOwn(provincesData, province) && !provincesData[province].includes(city)) {
    errors.city = "شهر انتخاب‌شده با استان مطابقت ندارد";
  }

  if (!street) errors.street = "خیابان اصلی را وارد کنید";

  if (postalCode && postalCode.length !== 10) errors.postal_code = "کد پستی باید ۱۰ رقم باشد";

  return errors;
}

export function validatePhone(value: string | null | undefined, required: boolean): string | undefined {
  const v = (value || "").trim();
  if (!v) return required ? "شماره تماس را وارد کنید" : undefined;
  if (!MOBILE_RE.test(v)) return "شماره موبایل باید با 09 شروع شود و ۱۱ رقم باشد";
  return undefined;
}

export function validateContact(contact: { phone1?: string; phone2?: string } | null | undefined): FieldErrors {
  const errors: FieldErrors = {};
  const phone1Error = validatePhone(contact?.phone1, true);
  if (phone1Error) errors.phone1 = phone1Error;
  const phone2Error = validatePhone(contact?.phone2, false);
  if (phone2Error) errors.phone2 = phone2Error;
  return errors;
}

function numberInRange(value: string | undefined, min: number, max: number): boolean {
  if (!value) return true;
  if (!/^\d+$/.test(value)) return false;
  const n = Number(value);
  return n >= min && n <= max;
}

export function validateOwnerExtra(
  carData: { mileage?: string; vin?: string; displayName?: string } | null | undefined
): FieldErrors {
  const errors: FieldErrors = {};
  if (carData?.mileage && !numberInRange(carData.mileage, 0, 2000000)) {
    errors.mileage = "کیلومتر کارکرد باید عددی بین ۰ تا ۲,۰۰۰,۰۰۰ باشد";
  }
  // Only the length the form itself already advertises ("۱۷ کاراکتر") is enforced;
  // no new VIN checksum/format policy is introduced.
  if (carData?.vin && carData.vin.trim().length !== 17) {
    errors.vin = "شماره شاسی (VIN) باید ۱۷ کاراکتر باشد";
  }
  if (carData?.displayName && carData.displayName.trim().length > 40) {
    errors.displayName = "نام ماشین باید حداکثر ۴۰ کاراکتر باشد";
  }
  return errors;
}

export function validateSellerExtra(
  sellerData: { experience?: string; warranty?: string } | null | undefined
): FieldErrors {
  const errors: FieldErrors = {};
  if (sellerData?.experience && !numberInRange(sellerData.experience, 0, 70)) {
    errors.experience = "سال سابقه کار باید عددی بین ۰ تا ۷۰ باشد";
  }
  if (sellerData?.warranty && !numberInRange(sellerData.warranty, 0, 120)) {
    errors.warranty = "گارانتی خدمات باید عددی بین ۰ تا ۱۲۰ ماه باشد";
  }
  return errors;
}

export function validateRescuerExtra(
  rescuerData: { radius?: string; experience?: string } | null | undefined
): FieldErrors {
  const errors: FieldErrors = {};
  if (rescuerData?.radius && !numberInRange(rescuerData.radius, 1, 500)) {
    errors.radius = "شعاع سرویس‌دهی باید عددی بین ۱ تا ۵۰۰ کیلومتر باشد";
  }
  if (rescuerData?.experience && !numberInRange(rescuerData.experience, 0, 70)) {
    errors.experience = "سال سابقه امدادگری باید عددی بین ۰ تا ۷۰ باشد";
  }
  return errors;
}

export type ProfileFormType = "owner" | "seller" | "service" | "rescuer";

export type ProfileFormState = {
  addressData: { province?: string; city?: string; street?: string; postal_code?: string } | null | undefined;
  contact: { phone1?: string; phone2?: string } | null | undefined;
  carData?: { mileage?: string; vin?: string; displayName?: string } | null | undefined;
  sellerData?: { experience?: string; warranty?: string } | null | undefined;
  rescuerData?: { radius?: string; experience?: string } | null | undefined;
};

export function validateProfileForm(
  type: ProfileFormType,
  state: ProfileFormState,
  provincesData: Record<string, string[]>
): FieldErrors {
  const errors: FieldErrors = {
    ...validateAddress(state.addressData, provincesData),
    ...validateContact(state.contact),
  };

  if (type === "owner") Object.assign(errors, validateOwnerExtra(state.carData));
  if (type === "seller") Object.assign(errors, validateSellerExtra(state.sellerData));
  if (type === "service") Object.assign(errors, validateSellerExtra(state.sellerData));
  if (type === "rescuer") Object.assign(errors, validateRescuerExtra(state.rescuerData));

  return errors;
}

export function isValid(errors: FieldErrors): boolean {
  return Object.keys(errors).length === 0;
}
