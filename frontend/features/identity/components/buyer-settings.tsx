"use client";
import Link from "next/link";
import { useState } from "react";
import type { Locale } from "../../../lib/i18n/locales";
import { accountSettingsCopy } from "../../../lib/i18n/account-settings";
import { organizationCopy, label } from "../../../lib/i18n/organizations";
import { Badge } from "../../../components/shadcn/badge";
import { Button } from "../../../components/shadcn/button";
import { Card } from "../../../components/shadcn/card";
import { Icon } from "../../../components/ui/icon";
import { salesTableCard } from "../../sales/components/seller-sales-ui";
import { EmailPreference } from "../../notifications/components/email-preference";
import { CloseAccount } from "../../../components/accounts/close-account";
import { ProfileEditor } from "../../organizations/components/profile-editor";
import { DetailDialog } from "../../orders/components/detail-dialog";
import {
	useWorkflow,
	WorkflowState,
} from "../../organizations/components/workflow-state";
import {
	profilePath,
	type Profile,
} from "../../organizations/api/organizations";

const statusBadge: Record<string, string> = {
	approved: "border-0 bg-success-surface text-success",
	rejected: "border-0 bg-danger-surface text-danger",
	submitted: "border-0 bg-warning-surface text-warning",
	under_review: "border-0 bg-warning-surface text-warning",
	needs_information: "border-0 bg-warning-surface text-warning",
	pending: "border-0 bg-warning-surface text-warning",
};

export function BuyerSettings({ locale }: { locale: Locale }) {
	const t = accountSettingsCopy[locale],
		o = organizationCopy[locale];
	const state = useWorkflow<{ profiles: Profile[] }>(
		profilePath("buyer"),
		locale,
	);
	const profiles =
		state.data?.profiles.filter((p) => p.kind === "business") ?? [];
	const [createOpen, setCreateOpen] = useState(false);
	const base = `/${locale}/account/buyer`;
	return (
		<div className="space-y-6" data-testid="account-settings">
			<div>
				<h1 className="m-0 text-xl font-semibold tracking-tight">{t.title}</h1>
				<p className="m-0 mt-1 text-sm text-muted">{t.subtitle}</p>
			</div>
			<EmailPreference key={locale} locale={locale} context="buyer" />
			<div className="grid items-start gap-6 lg:grid-cols-2">
				<Card
					className={salesTableCard}
					aria-labelledby="business-settings-heading"
				>
					<div className="flex flex-wrap items-center justify-between gap-3 border-0 border-b border-solid border-border px-4 py-4 sm:px-5">
						<div className="min-w-0">
							<h2
								id="business-settings-heading"
								className="m-0 text-base font-semibold"
							>
								{t.upgrade}
							</h2>
							<p className="m-0 text-xs text-muted">{t.description}</p>
						</div>
						<DetailDialog
							locale={locale}
							title={t.create}
							icon="team"
							label={t.create}
							description={t.description}
							wide
							keepMounted
							open={createOpen}
							onOpenChange={setCreateOpen}
							trigger={
								<Button
									type="button"
									size="sm"
									className="shrink-0 gap-2"
									onClick={() => setCreateOpen(true)}
								>
									<Icon name="plus" className="size-3.5" />
									{t.create}
								</Button>
							}
						>
							<ProfileEditor
								locale={locale}
								context="buyer"
								kinds={["business"]}
								busy={state.busy}
								errors={state.fields}
								onSave={async (data) => {
									if (await state.mutate(profilePath("buyer"), data))
										setCreateOpen(false);
								}}
							/>
						</DetailDialog>
					</div>
					<div className="px-4 py-4 sm:px-5">
						<WorkflowState state={state} locale={locale} />
						{state.data && profiles.length > 0 && (
							<ul className="m-0 list-none divide-y divide-border p-0">
								{profiles.map((p) => (
									<li key={p.id}>
										<Link
											href={`${base}/organizations/${p.id}`}
											className="-mx-4 flex min-h-11 items-center gap-3 px-4 py-3 text-foreground no-underline transition-colors hover:bg-info focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-action sm:-mx-5 sm:px-5"
										>
											<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-page text-muted">
												<Icon name="store" className="size-4" />
											</span>
											<span className="min-w-0 flex-1 truncate text-sm font-medium">
												{p.display_name}
											</span>
											<Badge
												variant="secondary"
												className={
													statusBadge[p.review_status] ??
													"border-0 bg-page text-muted"
												}
											>
												{label(o, p.review_status)}
											</Badge>
											<Icon
												name="chevron"
												className="size-4 shrink-0 text-muted rtl:-scale-x-100"
											/>
										</Link>
									</li>
								))}
							</ul>
						)}
						{state.data && profiles.length === 0 && (
							<div className="flex items-center gap-3 py-2">
								<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-page text-muted">
									<Icon name="store" className="size-4" />
								</span>
								<p className="m-0 text-sm text-muted">{o.empty}</p>
							</div>
						)}
					</div>
				</Card>
				<CloseAccount locale={locale} context="buyer" flat />
			</div>
		</div>
	);
}
