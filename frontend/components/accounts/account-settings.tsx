"use client";
import Link from "next/link";
import { EmailPreference } from "../../features/notifications/components/email-preference";
import { CloseAccount } from "./close-account";
import type { Locale } from "../../lib/i18n/locales";
import { accountSettingsCopy } from "../../lib/i18n/account-settings";
import { organizationCopy, label } from "../../lib/i18n/organizations";
import { ProfileEditor } from "../../features/organizations/components/profile-editor";
import {
	useWorkflow,
	WorkflowState,
} from "../../features/organizations/components/workflow-state";
import {
	profilePath,
	type Profile,
} from "../../features/organizations/api/organizations";
export function AccountSettings({
	locale,
	context,
}: {
	locale: Locale;
	context: "buyer" | "seller";
}) {
	const t = accountSettingsCopy[locale],
		o = organizationCopy[locale];
	const state = useWorkflow<{ profiles: Profile[] }>(
		profilePath(context),
		locale,
	);
	const base = `/${locale}/account/${context}`,
		kind = context === "seller" ? "company" : "business";
	return (
		<div className="space-y-6" data-testid="account-settings">
			<h1 className="text-3xl font-bold">{t.title}</h1>
			<EmailPreference
				key={`${locale}:${context}`}
				locale={locale}
				context={context}
			/>
			<nav className="flex flex-wrap gap-4 text-sm font-semibold">
				<Link
					className="inline-flex min-h-11 items-center"
					href={`${base}/profile`}
				>
					{t.profile}
				</Link>
				<Link
					className="inline-flex min-h-11 items-center"
					href={`${base}/password`}
				>
					{t.security}
				</Link>
				<Link
					className="inline-flex min-h-11 items-center"
					href={`${base}/link`}
				>
					{t.roles}
				</Link>
			</nav>
			<section
				aria-labelledby="business-settings-heading"
				className="space-y-4 rounded-card border border-border bg-surface p-5"
			>
				<h2 id="business-settings-heading" className="text-xl font-bold">
					{t.upgrade}
				</h2>
				<p className="max-w-3xl text-muted">{t.description}</p>
				<WorkflowState state={state} locale={locale} />
				{state.data && (
					<>
						<h3 className="font-bold">{t.existing}</h3>
						<ul className="space-y-3">
							{state.data.profiles
								.filter((p) => p.kind === kind)
								.map((p) => (
									<li key={p.id}>
										<Link
											className="inline-flex min-h-11 items-center gap-3"
											href={`${base}/organizations/${p.id}`}
										>
											{p.display_name}
											<span className="text-sm text-muted">
												{label(o, p.review_status)}
											</span>
										</Link>
									</li>
								))}
						</ul>
						{(kind === "company" ||
							!state.data.profiles.some((p) => p.kind === "business")) && (
							<details>
								<summary className="min-h-11 cursor-pointer py-3 font-bold text-action">
									{t.create}
								</summary>
								<ProfileEditor
									locale={locale}
									context={context}
									kinds={[kind]}
									busy={state.busy}
									errors={state.fields}
									onSave={(data) => state.mutate(profilePath(context), data)}
								/>
							</details>
						)}
					</>
				)}
			</section>
			<CloseAccount locale={locale} context={context} />
		</div>
	);
}
