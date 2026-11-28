"use client";
import { ApprovalStatus } from "./approval-status";
import Link from "next/link";
import { useState } from "react";
import toast from "react-hot-toast";
import { accountSettingsCopy } from "../../../lib/i18n/account-settings";
import { Button } from "../../../components/shadcn/button";
import {
	NativeSelect,
	NativeSelectOption,
} from "../../../components/shadcn/native-select";
import { BusinessDialog } from "../../../components/accounts/seller-settings-ui";
import { DashboardCard } from "../../../components/ui/dashboard-card";
import { EmptyState } from "../../../components/ui/empty-state";
import { Icon } from "../../../components/ui/icon";
import { StatCard } from "../../../components/ui/stat-card";
import { pageBannerClass } from "../../../components/ui/page-header";
import {
	StatusBadge,
	statusVariant,
} from "../../../components/ui/status-badge";
import { TabNav } from "../../../components/ui/tabs";
import { organizationCopy, label } from "../../../lib/i18n/organizations";
import type { Locale } from "../../../lib/i18n/locales";
import { sellerBusinessCopy } from "../../../lib/i18n/seller-business";
import { sellerSettingsCopy } from "../../../lib/i18n/seller-settings";
import { sellerHref } from "../../../lib/routes/account-routes";
import { ApplicationPanel } from "../../verification/components/application-panel";
import { profilePath, type Profile } from "../api/organizations";
import { ProfileEditor } from "./profile-editor";
import { useSellerBusinessGuard } from "./seller-business-ui";
import { TeamPanel } from "./team-panel";
import { useSellerWorkflow, WorkflowState } from "./workflow-state";

type WorkspaceProps = {
	locale: Locale;
	context: string;
	profileId?: string;
	sellerBusiness?: boolean;
	emailVerified?: boolean;
};
export function OrganizationWorkspace(props: WorkspaceProps) {
	return props.sellerBusiness && props.context === "seller" ? (
		<SellerOrganizationWorkspace {...props} />
	) : null;
}

const rowLinkClass =
	"flex min-w-0 items-center gap-3 rounded-control px-2 py-3 text-foreground no-underline transition-colors hover:bg-info focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-action motion-reduce:transition-none";

function SellerOrganizationWorkspace({
	locale,
	profileId,
	emailVerified = false,
}: WorkspaceProps) {
	const guard = useSellerBusinessGuard(locale);
	const state = useSellerWorkflow<Profile | { profiles: Profile[] }>(
		profilePath("seller", profileId),
		locale,
		{ lock: guard.lock },
	);
	const t = organizationCopy[locale],
		copy = sellerBusinessCopy[locale];
	const profiles =
		state.data && "profiles" in state.data ? state.data.profiles : [];
	const selected =
		profileId && state.data && "id" in state.data && state.data.id === profileId
			? state.data
			: null;
	const [creationKind, setCreationKind] = useState<"individual" | "company">(
		"individual",
	);
	const [createOpen, setCreateOpen] = useState(false);
	const [tab, setTab] = useState("profile");
	const [profileEpoch, setProfileEpoch] = useState(0);
	const allowed = selected
		? selected.can_manage
			? [
					"profile",
					"application",
					...(selected.kind === "company" ? ["team"] : []),
				]
			: selected.kind === "company"
				? ["team"]
				: []
		: [];
	const active = allowed.includes(tab) ? tab : allowed[0];
	const reload = () =>
		guard.choose(() => {
			void state.refresh().then((fresh) => {
				if (fresh) setProfileEpoch((value) => value + 1);
			});
		});
	const disabled = state.busy || state.blocked || state.loading;
	const approvedCount = profiles.filter(
		(profile) => profile.entitlement,
	).length;
	const reviewCount = profiles.filter(
		(profile) => profile.review_status === "under_review",
	).length;
	return (
		<div className="min-w-0 space-y-6" data-testid="seller-business-workspace">
			{guard.feedback}
			{!profileId && (
				<header className={pageBannerClass}>
					<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
						<div className="min-w-0 space-y-1">
							<p className="m-0 text-xs font-semibold text-action">
								{sellerSettingsCopy[locale].businessScope}
							</p>
							<h1 className="m-0 text-page-title font-bold">{copy.title}</h1>
							<p className="m-0 max-w-2xl text-sm leading-relaxed text-muted">
								{copy.help}
							</p>
						</div>
						{state.data && (
							<BusinessDialog
								locale={locale}
								title={t.create}
								description={copy.individualHelp}
								open={createOpen}
								busy={state.busy}
								onOpenChange={(open) => {
									if (open) setCreateOpen(true);
									else
										guard.choose(() => {
											setCreateOpen(false);
											setProfileEpoch((value) => value + 1);
										});
								}}
								trigger={
									<Button
										type="button"
										disabled={disabled}
										className="min-h-11 shrink-0 rounded-lg"
									>
										<Icon name="plus" className="size-4" />
										{t.create}
									</Button>
								}
							>
								<WorkflowState
									locale={locale}
									state={{ ...state, notice: "", refresh: reload }}
								/>
								<div className="space-y-2">
									<label
										htmlFor="seller-business-kind"
										className="block text-sm font-medium"
									>
										{t.profile}
									</label>
									<NativeSelect
										id="seller-business-kind"
										value={creationKind}
										disabled={disabled}
										onChange={(event) => {
											const kind = event.target.value as
												| "individual"
												| "company";
											if (kind !== creationKind)
												guard.choose(() => setCreationKind(kind));
										}}
									>
										<NativeSelectOption value="individual">
											{t.individual}
										</NativeSelectOption>
										<NativeSelectOption value="company">
											{t.company}
										</NativeSelectOption>
									</NativeSelect>
									{creationKind === "company" && (
										<p className="m-0 text-sm leading-relaxed text-muted">
											{accountSettingsCopy[locale].description}
										</p>
									)}
								</div>
								<ProfileEditor
									key={`new:${creationKind}:${profileEpoch}`}
									locale={locale}
									context="seller"
									sellerBusiness
									singleCreationKind
									kinds={[creationKind]}
									busy={disabled}
									errors={state.fields}
									onDirtyChange={guard.profileDirty}
									onCancel={() =>
										guard.choose(() => {
											setCreateOpen(false);
											setProfileEpoch((value) => value + 1);
										})
									}
									onSave={async (data) => {
										const result = await state.mutate(
											profilePath("seller"),
											data,
										);
										if (!result) return false;
										toast.success(t.saved);
										setCreateOpen(false);
										return true;
									}}
								/>
							</BusinessDialog>
						)}
					</div>
				</header>
			)}
			{!createOpen && (
				<WorkflowState locale={locale} state={{ ...state, refresh: reload }} />
			)}
			{!profileId && state.data && (
				<>
					<div className="grid auto-rows-fr grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-3">
						<StatCard
							compact
							icon="store"
							label={t.profileCount}
							value={profiles.length}
							locale={locale}
						/>
						<StatCard
							compact
							icon="check-circle"
							chip="success"
							label={t.approved}
							value={approvedCount}
							locale={locale}
						/>
						<StatCard
							compact
							icon="clock"
							chip="warning"
							label={t.under_review}
							value={reviewCount}
							locale={locale}
							className="col-span-2 lg:col-span-1"
						/>
					</div>
					<DashboardCard
						title={t.yourProfiles}
						description={copy.individualHelp}
						icon="grid"
					>
						{profiles.length ? (
							<ul className="m-0 list-none divide-y divide-border p-0">
								{profiles.map((profile) => (
									<li key={profile.id}>
										<Link
											href={sellerHref(
												locale,
												`organizations/${profile.id}`,
												profile.id,
											)}
											aria-label={`${t.show} · ${profile.display_name}`}
											className={rowLinkClass}
										>
											<span
												className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-info text-action"
												aria-hidden="true"
											>
												<Icon
													name={profile.kind === "company" ? "team" : "store"}
													className="size-5"
												/>
											</span>
											<span className="min-w-0 flex-1">
												<span className="block wrap-anywhere font-semibold">
													<bdi>{profile.display_name}</bdi>
												</span>
												<span className="mt-0.5 block text-sm text-muted">
													{label(t, profile.kind)} ·{" "}
													{profile.entitlement ? t.eligible : t.ineligible}
												</span>
											</span>
											<StatusBadge
												variant={statusVariant(profile.review_status)}
												className="shrink-0"
											>
												{label(t, profile.review_status)}
											</StatusBadge>
											<Icon
												name="chevron"
												className="size-4 shrink-0 text-muted rtl:rotate-180"
											/>
										</Link>
									</li>
								))}
							</ul>
						) : (
							<EmptyState
								borderless
								icon="store"
								title={t.empty}
								description={copy.individualHelp}
							/>
						)}
					</DashboardCard>
				</>
			)}
			{profileId && (
				<Link
					href={sellerHref(locale, "organizations", selected?.id)}
					className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-action no-underline hover:underline"
				>
					<Icon name="arrow" className="size-4 rotate-180 rtl:rotate-0" />
					{copy.back}
				</Link>
			)}
			{selected && (
				<>
					<div className="min-w-0 overflow-hidden rounded-card border border-transparent bg-surface shadow-card dark:border-border">
						<div className="h-1 bg-primary" aria-hidden="true" />
						<div className="flex min-w-0 items-start gap-4 p-4 desktop:p-6">
							<span
								className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-primary text-on-primary"
								aria-hidden="true"
							>
								<Icon
									name={selected.kind === "company" ? "team" : "store"}
									className="size-6"
								/>
							</span>
							<div className="min-w-0 flex-1 space-y-1.5">
								<h1 className="m-0 wrap-anywhere text-lg font-bold sm:text-xl">
									<bdi>{selected.display_name}</bdi>
								</h1>
								<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted">
									<span>{label(t, selected.kind)}</span>
									<span
										title={t.emailVerified}
										className={`inline-flex items-center gap-1 rounded-control px-2 py-0.5 text-xs font-medium ${
											emailVerified
												? "bg-success/10 text-success"
												: "bg-warning/10 text-warning"
										}`}
									>
										<Icon
											name={emailVerified ? "check-circle" : "alert-triangle"}
											className="size-3"
										/>
										{emailVerified ? copy.verified : copy.unverified}
									</span>
								</div>
							</div>
						</div>
					</div>
					<div className="grid auto-rows-fr grid-cols-2 gap-2 sm:gap-4">
						<StatCard
							compact
							icon="shield"
							chip={statusVariant(selected.review_status)}
							label={t.status}
							value={label(t, selected.review_status)}
							locale={locale}
						/>
						<StatCard
							compact
							icon="award"
							chip={selected.entitlement ? "success" : "neutral"}
							label={t.entitlement}
							value={
								<span data-testid="profile-entitlement">
									{selected.entitlement ? t.eligible : t.ineligible}
								</span>
							}
							locale={locale}
						/>
					</div>
					<p className="m-0 text-sm leading-relaxed text-muted">
						<span className="block">{copy.authorityHelp}</span>
						<span className="mt-1 block">{t.emailVerified}</span>
					</p>
					<ApprovalStatus profile={selected} locale={locale} />
					<TabNav
						locale={locale}
						aria-label={t.sectionsNav}
						tabs={allowed.map((key) => ({
							label:
								key === "application"
									? copy.verification
									: t[key as "profile" | "team"],
							active: active === key,
							onClick: () => {
								if (active !== key) guard.choose(() => setTab(key));
							},
						}))}
					/>
					{selected.can_manage && active === "profile" && (
						<DashboardCard title={t.profile} icon="store">
							<ProfileEditor
								key={`${selected.id}:${profileEpoch}`}
								locale={locale}
								context="seller"
								profile={selected}
								sellerBusiness
								busy={disabled}
								errors={state.fields}
								onDirtyChange={guard.profileDirty}
								onSave={async (data) =>
									!!(await state.mutate(
										profilePath("seller", selected.id),
										data,
										"PATCH",
									))
								}
							/>
						</DashboardCard>
					)}
					{selected.can_manage && active === "application" && (
						<ApplicationPanel
							locale={locale}
							context="seller"
							profileId={selected.id}
							onChanged={state.refresh}
							sellerBusiness={{
								lock: guard.lock,
								refreshAuthority: state.refresh,
								choose: guard.choose,
								onDirtyChange: guard.applicationDirty,
							}}
						/>
					)}
					{selected.kind === "company" && active === "team" && (
						<TeamPanel
							locale={locale}
							context="seller"
							profile={selected}
							onChanged={state.refresh}
							sellerBusiness={{
								lock: guard.lock,
								refreshAuthority: state.refresh,
								choose: guard.choose,
								onDirtyChange: guard.teamDirty,
							}}
						/>
					)}
				</>
			)}
			{profileId && state.data && !selected && <p role="alert">{t.denied}</p>}
		</div>
	);
}
