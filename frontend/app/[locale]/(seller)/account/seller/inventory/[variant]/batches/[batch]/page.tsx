import {
	pageLocale,
	resourceId,
} from "../../../../../../../../../lib/routes/page";
import { PageContent } from "./components/batch-content";
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };
export default async function Page({
	params,
}: {
	params: Promise<{ locale: string; variant: string; batch: string }>;
}) {
	const value = await params;
	return (
		<PageContent
			locale={pageLocale(value.locale)}
			variant={resourceId(value.variant)}
			batch={resourceId(value.batch)}
		/>
	);
}
