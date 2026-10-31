import { pageLocale } from "../../../../../lib/routes/page";
import { PageContent } from "./components/page-content";
import { metadataFor } from "./components/page-content";
export async function generateMetadata(props: Props) {
	const p = await props.params;
	return metadataFor(pageLocale(p.locale), p, await props.searchParams);
}
export const dynamic = "force-dynamic";
type Props = {
	params: Promise<{ locale: string; product: string }>;
	searchParams: Promise<Record<string, string | string[] | undefined>>;
};
export default async function Page(props: Props) {
	const p = await props.params;
	return (
		<PageContent
			locale={pageLocale(p.locale)}
			params={p}
			search={await props.searchParams}
		/>
	);
}
