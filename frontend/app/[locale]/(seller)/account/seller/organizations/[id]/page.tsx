import { pageLocale, resourceId } from "../../../../../../../lib/routes/page";
import { PageContent } from "./components/id-content";
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };
export default async function Page({
	params,
}: {
	params: Promise<{ locale: string; id: string }>;
}) {
	const value = await params;
	return (
		<PageContent locale={pageLocale(value.locale)} id={resourceId(value.id)} />
	);
}
