"use client";
import Link from "next/link";
import { useState } from "react";
import { ExternalLink, Eye } from "lucide-react";
import { Button } from "../../../components/shadcn/button";
import { Card } from "../../../components/shadcn/card";
import { Alert } from "../../../components/ui/alert";
import { Icon } from "../../../components/ui/icon";
import {
	StatusBadge,
	statusVariant,
} from "../../../components/ui/status-badge";
import { accountSettingsCopy } from "../../../lib/i18n/account-settings";
import { organizationCopy, label } from "../../../lib/i18n/organizations";
import type { Locale } from "../../../lib/i18n/locales";
import { BuyerRowMenu } from "../../orders/components/buyer-ui";
import {
	DetailDialog,
	DialogLink,
} from "../../orders/components/detail-dialog";
import { salesTableCard } from "../../sales/components/seller-sales-ui";
import { profilePath, type Profile } from "../api/organizations";
import { OrganizationDetail } from "./organization-detail";
import { useWorkflow, WorkflowState } from "./workflow-state";

const listingHref = (locale: Locale) =>
	`/${locale}/account/buyer/organizations`;
const kindLabel = (t: (typeof organizationCopy)[Locale], kind: string) =>
	t[kind as "individual" | "company" | "business"];

export function BuyerOrganizations({ locale }: { locale: Locale }) {
	const state = useWorkflow<{ profiles: Profile[] }>(
		profilePath("buyer"),
		locale,
	);
	const t = organizationCopy[locale];
	const [viewingId, setViewingId] = useState<string | null>(null);
	const profiles = state.data?.profiles ?? [];
	const viewing = profiles.find((profile) => profile.id === viewingId);
	return (
		<div className="space-y-5">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<h1 className="m-0 text-xl font-semibold tracking-tight">
						{t.title}
					</h1>
					<p className="m-0 mt-1 text-sm text-muted">{t.approvalScope}</p>
				</div>
				<Button asChild variant="outline" size="sm" className="gap-2">
					<Link href={`/${locale}/account/buyer/settings`} prefetch={false}>
						<Icon name="plus" className="size-3.5" />
						{accountSettingsCopy[locale].upgrade}
					</Link>
				</Button>
			</div>
			<WorkflowState state={{ ...state, notice: "" }} locale={locale} />
			{state.data && (
				<Card className={salesTableCard}>
					{profiles.length > 0 ? (
						<ul className="m-0 list-none divide-y divide-border p-0">
							{profiles.map((profile) => (
								<li
									key={profile.id}
									className="flex items-center gap-1 pe-2 sm:pe-3"
								>
									<Link
										href={`${listingHref(locale)}/${profile.id}`}
										aria-label={profile.display_name}
										className="flex min-h-11 min-w-0 flex-1 items-center gap-3 px-4 py-3 text-foreground no-underline transition-colors hover:bg-info focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-action motion-reduce:transition-none sm:px-5"
									>
										<span
											aria-hidden="true"
											className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-page text-muted"
										>
											<Icon name="store" className="size-4" />
										</span>
										<span className="min-w-0 flex-1">
											<span className="block truncate text-sm font-medium">
												{profile.display_name}
											</span>
											<span className="block truncate text-xs text-muted">
												{kindLabel(t, profile.kind)}
											</span>
										</span>
										<StatusBadge
											size="sm"
											variant={statusVariant(profile.review_status)}
										>
											{label(t, profile.review_status)}
										</StatusBadge>
										<Icon
											name="chevron"
											className="size-4 shrink-0 text-muted rtl:-scale-x-100"
										/>
									</Link>
									<BuyerRowMenu
										locale={locale}
										label={`${t.actions}: ${profile.display_name}`}
										links={[
											{
												href: `${listingHref(locale)}/${profile.id}`,
												label: t.show,
												Icon: ExternalLink,
											},
										]}
										actions={[
											{
												label: t.quickView,
												Icon: Eye,
												onSelect: () => setViewingId(profile.id),
											},
										]}
									/>
								</li>
							))}
						</ul>
					) : (
						<div className="flex items-center gap-3 px-4 py-5 sm:px-5">
							<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-page text-muted">
								<Icon name="store" className="size-4" />
							</span>
							<p className="m-0 text-sm text-muted">{t.empty}</p>
						</div>
					)}
				</Card>
			)}
			<DetailDialog
				locale={locale}
				title={viewing?.display_name ?? t.profile}
				icon="store"
				label={t.quickView}
				description={viewing ? kindLabel(t, viewing.kind) : undefined}
				wide
				open={!!viewing}
				onOpenChange={(next) => {
					if (!next) setViewingId(null);
				}}
				trigger={<span />}
				footer={
					viewing ? (
						<DialogLink
							href={`${listingHref(locale)}/${viewing.id}`}
							icon="arrow"
						>
							{t.show}
						</DialogLink>
					) : undefined
				}
			>
				{viewing && (
					<OrganizationDetail
						locale={locale}
						profile={viewing}
						state={state}
						showTitle={false}
					/>
				)}
			</DetailDialog>
		</div>
	);
}

export function BuyerOrganizationPage({
	locale,
	id,
}: {
	locale: Locale;
	id: string;
}) {
	const state = useWorkflow<{ profiles: Profile[] }>(
		profilePath("buyer"),
		locale,
	);
	const t = organizationCopy[locale];
	const profile = state.data?.profiles.find((item) => item.id === id);
	return (
		<div className="space-y-5">
			<Link
				href={listingHref(locale)}
				className="inline-flex items-center gap-1.5 text-sm font-medium text-action no-underline hover:underline"
			>
				<Icon name="arrow" className="size-4 -scale-x-100 rtl:scale-x-100" />
				{t.title}
			</Link>
			<h1 className="sr-only">{profile?.display_name ?? t.title}</h1>
			<WorkflowState state={{ ...state, notice: "" }} locale={locale} />
			{profile && (
				<OrganizationDetail locale={locale} profile={profile} state={state} />
			)}
			{state.data && !profile && <Alert role="alert">{t.denied}</Alert>}
		</div>
	);
}
