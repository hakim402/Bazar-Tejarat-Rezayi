"use client";
import { useRouter } from "next/navigation";
import { Button } from "../../../components/ui/button";
import { contentCopy } from "../../../lib/i18n/content";
import type { Locale } from "../../../lib/i18n/locales";
export function Retry({ locale }: { locale: Locale }) {
	const router = useRouter();
	return (
		<Button onClick={() => router.refresh()}>
			{contentCopy[locale].retry}
		</Button>
	);
}
