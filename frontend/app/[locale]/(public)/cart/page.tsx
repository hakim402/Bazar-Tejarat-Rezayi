import { pageLocale } from "../../../../lib/routes/page";
import { PageContent } from "./components/content";
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };
export default async function Page({
	params,
}: {
	params: Promise<{ locale: string }>;
}) {
	return <PageContent locale={pageLocale((await params).locale)} />;
}
