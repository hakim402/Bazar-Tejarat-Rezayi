import { pageLocale } from "../../../../../../../lib/routes/page";
import { StoreSettings } from "./components/store-settings";
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };
export default async function Page({
	params,
}: {
	params: Promise<{ locale: string }>;
}) {
	return <StoreSettings locale={pageLocale((await params).locale)} />;
}
