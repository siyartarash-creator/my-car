# Legacy finance migrations

این پوشه فقط آرشیو migrationهای قدیمی `wallet_*` است و بخشی از زنجیرهٔ فعال migration نیست.

مدل canonical مالی پروژه از `supabase/migrations/202611040000_ledger_core.sql` شروع می‌شود و با migrationهای `ledger_*` ادامه پیدا می‌کند. هیچ migration جدیدی نباید به مدل قدیمی این پوشه اضافه شود.

برای تغییرات مالی، ابتدا migration زنجیرهٔ `ledger_*` و تست‌های مالی متناظر را به‌روزرسانی کنید.

آخرین به‌روزرسانی این فایل: 2026-11-06
