import type { ReactNode } from "react";
import { pageLocale } from "../../../../../lib/routes/page";
import { SellerShell } from "./components/seller-shell";
export const metadata = { robots: { index: false, follow: false } };
export default async function Layout({
	children,
	params,
}: {
	children: ReactNode;
	params: Promise<{ locale: string }>;
}) {
	const { locale } = await params;
	return <SellerShell locale={pageLocale(locale)}>{children}</SellerShell>;
}
