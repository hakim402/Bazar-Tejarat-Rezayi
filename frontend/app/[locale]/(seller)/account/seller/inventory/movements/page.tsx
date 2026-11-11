import { redirect } from "next/navigation";
import { pageLocale } from "../../../../../../../lib/routes/page";
import {
	sellerHref,
	uuidPattern,
} from "../../../../../../../lib/routes/account-routes";
export const dynamic = "force-dynamic";
export default async function Page({
	params,
	searchParams,
}: {
	params: Promise<{ locale: string }>;
	searchParams: Promise<{ seller?: string }>;
}) {
	const { locale } = await params,
		{ seller } = await searchParams;
	redirect(
		sellerHref(
			pageLocale(locale),
			"inventory",
			seller && uuidPattern.test(seller) ? seller : undefined,
		),
	);
}
