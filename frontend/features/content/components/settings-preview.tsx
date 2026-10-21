import type { Locale } from "../../../lib/i18n/locales";
import { contentCopy } from "../../../lib/i18n/content";
import type { Document } from "../types";
export function SettingsPreview({
	data,
	kind,
	locale,
}: {
	data: Document;
	kind: string;
	locale: Locale;
}) {
	const t = contentCopy[locale];
	if (kind === "support")
		return (
			<section className="space-y-3">
				<h2 className="text-2xl">{t.contact}</h2>
				<dl>
					{(["email", "phone", "website"] as const).map((key) => (
						<div key={key} className="space-y-1 py-2">
							<dt>{t[key]}</dt>
							<dd className="m-0 wrap-anywhere">
								<bdi dir="ltr">{data.support?.[key] || "—"}</bdi>
							</dd>
						</div>
					))}
				</dl>
			</section>
		);
	return (
		<section className="space-y-4">
			<h2 className="text-2xl">{t.navigation}</h2>
			{data.navigation?.map((group) => (
				<section key={group.id} className="space-y-2">
					<h3 className="text-xl">
						{group.label} · {t[group.placement]}
					</h3>
					<ul>
						{group.links.map((link) => (
							<li key={link.id}>
								{link.label} · <bdi dir="ltr">{link.target}</bdi>
							</li>
						))}
					</ul>
				</section>
			))}
		</section>
	);
}
