"use client";
import Link from "next/link";
import { accountSettingsCopy } from "../../../lib/i18n/account-settings";
import { useState } from "react";
import { organizationCopy, label } from "../../../lib/i18n/organizations";
import type { Locale } from "../../../lib/i18n/locales";
import {
	StatusBadge,
	statusVariant,
} from "../../../components/ui/status-badge";
import { EmptyState } from "../../../components/ui/empty-state";
import { TabNav } from "../../../components/ui/tabs";
import { ApplicationPanel } from "../../verification/components/application-panel";
import { profilePath, type Profile } from "../api/organizations";
import { ProfileEditor } from "./profile-editor";
import { TeamPanel } from "./team-panel";
import { useSearchParams } from "next/navigation";
import { sellerHref, uuidPattern } from "../../../lib/routes/account-routes";
import { sellerBusinessCopy } from "../../../lib/i18n/seller-business";
import {
	SettingsSection,
	settingsSecondary,
} from "../../../components/accounts/seller-settings-ui";
import { useSellerBusinessGuard } from "./seller-business-ui";
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
	const query = useSearchParams().get("seller");
	const profiles =
		state.data && "profiles" in state.data ? state.data.profiles : [];
	const selected =
		profileId && state.data && "id" in state.data && state.data.id === profileId
			? state.data
			: null;
	// Query context is useful only when it is one of the actually returned directory profiles.
	const scope =
		selected?.id ??
		(query &&
		uuidPattern.test(query) &&
		profiles.some((item) => item.id === query)
			? query
			: null);
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
	return (
		<div className="min-w-0 space-y-6" data-testid="seller-business-workspace">
			{guard.feedback}
			<header className="space-y-3">
				{profileId && (
					<Link
						className={settingsSecondary}
						href={sellerHref(locale, "organizations", selected?.id)}
					>
						{copy.back}
					</Link>
				)}
				<h1 className="text-page-title font-bold break-words">
					{selected?.display_name ?? copy.title}
				</h1>
				<p className="max-w-3xl text-muted leading-relaxed">{copy.help}</p>
				{(!profileId || selected) && (
					<nav className="flex flex-wrap gap-3" aria-label={t.title}>
						<Link
							className={settingsSecondary}
							href={sellerHref(locale, "", scope)}
						>
							{t.back}
						</Link>
						<Link
							className={settingsSecondary}
							href={sellerHref(locale, "settings", scope)}
						>
							{accountSettingsCopy[locale].title}
						</Link>
					</nav>
				)}
			</header>
			<WorkflowState locale={locale} state={{ ...state, refresh: reload }} />
			{!profileId && state.data && (
				<>
					<div className="grid min-w-0 gap-4 md:grid-cols-2">
						{profiles.map((profile) => (
							<SettingsSection key={profile.id} title={profile.display_name}>
								<p className="flex flex-wrap gap-2 items-center">
									<span>{label(t, profile.kind)}</span>
									<StatusBadge variant={statusVariant(profile.review_status)}>
										{label(t, profile.review_status)}
									</StatusBadge>
								</p>
								<p>
									{t.entitlement}:{" "}
									<strong>
										{profile.entitlement ? t.eligible : t.ineligible}
									</strong>
								</p>
								<Link
									className={settingsSecondary}
									href={sellerHref(
										locale,
										`organizations/${profile.id}`,
										profile.id,
									)}
								>
									{t.show}
								</Link>
							</SettingsSection>
						))}
					</div>
					{!profiles.length && (
						<EmptyState
							icon="store"
							title={t.empty}
							description={copy.individualHelp}
						/>
					)}
					<details
						className="rounded-2xl border border-border bg-surface p-4 sm:p-6"
						open={!profiles.length || undefined}
					>
						<summary className="min-h-11 cursor-pointer py-3 font-semibold">
							{t.create}
						</summary>
						<p className="my-4 text-muted leading-relaxed">
							{copy.individualHelp}
						</p>
						<ProfileEditor
							key={`new:${profileEpoch}`}
							locale={locale}
							context="seller"
							sellerBusiness
							singleCreationKind
							kinds={["individual"]}
							busy={disabled}
							errors={state.fields}
							onDirtyChange={guard.profileDirty}
							onSave={async (data) =>
								!!(await state.mutate(profilePath("seller"), data))
							}
						/>
					</details>
					<Link
						className={settingsSecondary}
						href={sellerHref(locale, "settings", scope)}
					>
						{accountSettingsCopy[locale].upgrade}
					</Link>
				</>
			)}
			{selected && (
				<>
					<SettingsSection
						title={selected.display_name}
						description={copy.authorityHelp}
					>
						<dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
							<div>
								<dt className="text-sm text-muted">{t.profile}</dt>
								<dd className="mt-1 font-semibold">
									{label(t, selected.kind)}
								</dd>
							</div>
							<div>
								<dt className="text-sm text-muted">{t.status}</dt>
								<dd className="mt-1">
									<StatusBadge variant={statusVariant(selected.review_status)}>
										{label(t, selected.review_status)}
									</StatusBadge>
								</dd>
							</div>
							<div>
								<dt className="text-sm text-muted">{t.entitlement}</dt>
								<dd
									className="mt-1 font-semibold"
									data-testid="profile-entitlement"
								>
									{selected.entitlement ? t.eligible : t.ineligible}
								</dd>
							</div>
							<div>
								<dt className="text-sm text-muted">{copy.email}</dt>
								<dd className="mt-1 font-semibold">
									{emailVerified ? copy.verified : copy.unverified}
								</dd>
							</div>
						</dl>
						<p className="text-sm text-muted">{t.emailVerified}</p>
					</SettingsSection>
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
