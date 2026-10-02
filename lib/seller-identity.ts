// Seller Profile <-> Store cohesion contract.
//
// Account Identity (profiles.id / profiles.name / profiles.mobile) authenticates
// and owns rows; it is immutable post-signup and must never be overloaded as the
// seller's commercial/business-facing label.
//
// Seller Business Identity is the subset of the seller's own Profile data used for
// commercial presentation: shop/business name (profiles.data.seller.shopName),
// business contact (profiles.phone1/phone2), description (profiles.about), and
// business socials (profiles.social_links). This module centralizes the one
// fallback rule so it isn't reimplemented ad hoc across Store surfaces:
//
//   business name = shopName (if set) else Account name (never blank).

export type SellerProfileRow = {
  name: string;
  phone1?: string | null;
  phone2?: string | null;
  about?: string | null;
  social_links?: Record<string, string> | null;
  data?: {
    seller?: {
      shopName?: string | null;
      specialties?: string[] | null;
      saleType?: string | null;
      minOrder?: number | string | null;
    } | null;
  } | null;
};

export type SellerBusinessIdentity = {
  /** Deterministic, never-blank display name for Store surfaces. */
  businessName: string;
  /** True when no shop/business name was set and the Account name was used instead. */
  usedAccountNameFallback: boolean;
  contactPhone1: string | null;
  contactPhone2: string | null;
  about: string | null;
  socialLinks: Record<string, string> | null;
  specialties: string[];
  saleType: string | null;
  minOrder: number | string | null;
};

/**
 * Resolves a seller's Business Identity from their own Profile row.
 * Only call this with a profile the caller is authorized to read in full
 * (the seller themself, or an admin) — it is not a public-identity resolver.
 */
export function resolveSellerBusinessIdentity(
  profile: SellerProfileRow | null | undefined
): SellerBusinessIdentity {
  const shopName = profile?.data?.seller?.shopName?.trim();
  const accountName = profile?.name?.trim() || "";

  return {
    businessName: shopName || accountName,
    usedAccountNameFallback: !shopName,
    contactPhone1: profile?.phone1 ?? null,
    contactPhone2: profile?.phone2 ?? null,
    about: profile?.about ?? null,
    socialLinks: profile?.social_links ?? null,
    specialties: profile?.data?.seller?.specialties ?? [],
    saleType: profile?.data?.seller?.saleType ?? null,
    minOrder: profile?.data?.seller?.minOrder ?? null,
  };
}

/**
 * Fallback label for buyer-facing Store surfaces when no seller name snapshot
 * is available at all (defensive only — product_sellers.seller_name is NOT NULL
 * in the schema, so this should not normally be reached).
 */
export const STORE_SELLER_FALLBACK_LABEL = "فروشگاه ماشین من";
