import { pageLocale } from "../../../../../../lib/routes/page";
import { PageContent } from "./components/content";
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };
export default async function Page({
	params,
}: {
	params: Promise<{ locale: string; conversation?: string }>;
}) {
	const value = await params;

	return <PageContent locale={pageLocale(value.locale)} />;
}
