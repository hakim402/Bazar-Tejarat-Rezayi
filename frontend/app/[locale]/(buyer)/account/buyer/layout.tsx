import type { ReactNode } from "react";
import { pageLocale } from "../../../../../lib/routes/page";
import { BuyerShell } from "./components/buyer-shell";
export const metadata = { robots: { index: false, follow: false } };
export default async function Layout({
	children,
	params,
}: {
	children: ReactNode;
	params: Promise<{ locale: string }>;
}) {
	const { locale } = await params;
	return <BuyerShell locale={pageLocale(locale)}>{children}</BuyerShell>;
}
