import type { Metadata } from "next";
import { CartProvider } from "@/lib/cart-context";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-client";

export const metadata: Metadata = {
  title: "ماشین من - اپلیکیشن جامع خودرو",
  description: "خرید قطعات، خدمات فنی، امداد سیار و هرچی یه راننده نیاز داره",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl">
      <body className="antialiased">
        <AuthProvider><CartProvider>{children}</CartProvider></AuthProvider>
      </body>
    </html>
  );
}