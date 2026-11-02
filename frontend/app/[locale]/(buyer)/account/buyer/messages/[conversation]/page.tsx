import { pageLocale } from "../../../../../../../lib/routes/page";
import { PageContent } from "./components/content";
import { notFound } from "next/navigation";
import { uuidPattern } from "../../../../../../../lib/routes/account-routes";
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };
export default async function Page({
	params,
}: {
	params: Promise<{ locale: string; conversation?: string }>;
}) {
	const value = await params;
	if (!value.conversation || !uuidPattern.test(value.conversation)) notFound();
	return (
		<PageContent
			locale={pageLocale(value.locale)}
			conversation={value.conversation}
		/>
	);
}
