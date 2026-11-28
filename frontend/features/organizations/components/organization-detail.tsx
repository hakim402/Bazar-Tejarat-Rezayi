"use client";
import { ApprovalStatus } from "./approval-status";
import { useState } from "react";
import toast from "react-hot-toast";
import { Pencil } from "lucide-react";
import { Button } from "../../../components/shadcn/button";
import { Card } from "../../../components/shadcn/card";
import { Alert } from "../../../components/ui/alert";
import { Icon } from "../../../components/ui/icon";
import {
	StatusBadge,
	statusVariant,
} from "../../../components/ui/status-badge";
import { TabNav } from "../../../components/ui/tabs";
import { organizationCopy, label } from "../../../lib/i18n/organizations";
import type { Locale } from "../../../lib/i18n/locales";
import { DetailDialog } from "../../orders/components/detail-dialog";
import { salesTableCard } from "../../sales/components/seller-sales-ui";
import { profilePath, type Profile } from "../api/organizations";
import { BuyerApplicationPanel } from "./buyer-application";
import { BuyerTeamPanel } from "./buyer-team";
import { ProfileEditor, profileGroups } from "./profile-editor";
import type { useWorkflow } from "./workflow-state";

type ListState = ReturnType<typeof useWorkflow<{ profiles: Profile[] }>>;

// One detail surface shared by the listing quick-view dialog and the
// standalone profile page; panels own their data and refresh the parent.
export function OrganizationDetail({
	locale,
	profile,
	state,
	showTitle = true,
}: {
	locale: Locale;
	profile: Profile;
	state: ListState;
	showTitle?: boolean;
}) {
	const t = organizationCopy[locale];
	const [tab, setTab] = useState("profile");
	const [editOpen, setEditOpen] = useState(false);
	const allowed = profile.can_manage
		? [
				"profile",
				"application",
				...(profile.kind === "company" ? ["team"] : []),
			]
		: profile.kind === "company"
			? ["team"]
			: [];
	const active = allowed.includes(tab) ? tab : allowed[0];
	async function saveProfile(data: Record<string, unknown>) {
		const ok = await state.mutate(
			profilePath("buyer", profile.id),
			data,
			"PATCH",
		);
		if (ok) toast.success(t.saved);
		return ok;
	}
	return (
		<div className="min-w-0 space-y-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0 space-y-1.5">
					<div className="flex flex-wrap items-center gap-2">
						{showTitle && (
							<h2 className="m-0 break-words text-xl font-bold tracking-tight">
								<bdi>{profile.display_name}</bdi>
							</h2>
						)}
						<StatusBadge variant={statusVariant(profile.review_status)}>
							{label(t, profile.review_status)}
						</StatusBadge>
						<span className="text-xs text-muted">
							{t[profile.kind as "individual" | "company" | "business"]}
						</span>
					</div>
					<p className="m-0 text-sm" data-testid="profile-entitlement">
						{t.entitlement}:{" "}
						<strong>{profile.entitlement ? t.eligible : t.ineligible}</strong>
					</p>
					<p className="m-0 text-xs text-muted">{t.emailVerified}</p>
				</div>
				{profile.can_manage && (
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="gap-2"
						onClick={() => setEditOpen(true)}
					>
						<Pencil className="size-3.5" aria-hidden="true" />
						{t.editProfile}
					</Button>
				)}
			</div>
			<ApprovalStatus profile={profile} locale={locale} />
			{allowed.length > 0 && (
				<TabNav
					locale={locale}
					aria-label={t.sectionsNav}
					tabs={allowed.map((key) => ({
						label: t[key as "profile" | "application" | "team"],
						active: active === key,
						onClick: () => setTab(key),
					}))}
				/>
			)}
			{active === "profile" && profile.can_manage && (
				<Card className={salesTableCard}>
					<div className="divide-y divide-border px-4 py-1 sm:px-5">
						{profileGroups.map((group) => (
							<section key={group.title} className="space-y-2 py-4">
								<h3 className="m-0 flex items-center gap-1.5 text-sm font-semibold">
									{group.help && (
										<Icon name="lock" className="size-3.5 text-muted" />
									)}
									{t[group.title]}
								</h3>
								{group.help && (
									<p className="m-0 text-xs text-muted">{t[group.help]}</p>
								)}
								<dl className="m-0 grid gap-3 sm:grid-cols-2">
									{group.keys.map((key) => (
										<div key={key} className="min-w-0">
											<dt className="text-xs text-muted">{t[key]}</dt>
											<dd
												className="m-0 mt-0.5 break-words text-sm font-medium"
												dir={key === "contact_phone" ? "ltr" : undefined}
											>
												{profile[key] || "—"}
											</dd>
										</div>
									))}
								</dl>
							</section>
						))}
					</div>
				</Card>
			)}
			{active === "application" && profile.can_manage && (
				<BuyerApplicationPanel
					locale={locale}
					profileId={profile.id}
					onChanged={state.refresh}
				/>
			)}
			{active === "team" && profile.kind === "company" && (
				<BuyerTeamPanel
					locale={locale}
					profile={profile}
					onChanged={state.refresh}
				/>
			)}
			<DetailDialog
				locale={locale}
				title={t.editProfile}
				icon="user"
				label={t.editProfile}
				description={profile.display_name}
				wide
				open={editOpen}
				onOpenChange={setEditOpen}
				trigger={<span />}
			>
				{state.error && (
					<Alert role="alert" className="m-0 text-sm">
						{state.error}
					</Alert>
				)}
				<ProfileEditor
					key={profile.version}
					locale={locale}
					context="buyer"
					profile={profile}
					busy={state.busy}
					errors={state.fields}
					onSave={async (data) => {
						if (await saveProfile(data)) setEditOpen(false);
					}}
				/>
			</DetailDialog>
		</div>
	);
}
