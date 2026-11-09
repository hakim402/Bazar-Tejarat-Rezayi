"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale } from "../../../../../../../lib/i18n/locales";
import { sellerSettingsCopy } from "../../../../../../../lib/i18n/seller-settings";
import { accountSettingsCopy } from "../../../../../../../lib/i18n/account-settings";
import { organizationCopy } from "../../../../../../../lib/i18n/organizations";
import { authCopy } from "../../../../../../../lib/i18n/auth";
import {
	sellerHref,
	uuidPattern,
} from "../../../../../../../lib/routes/account-routes";
import { AccountError } from "../../../../../../../lib/api/private-client";
import {
	useCommunicationSession,
	accessLost,
} from "../../../../../../../features/messaging/hooks";
import {
	orgRequest,
	profilePath,
	type Profile,
} from "../../../../../../../features/organizations/api/organizations";
import { ProfileEditor } from "../../../../../../../features/organizations/components/profile-editor";
import { EmailPreference } from "../../../../../../../features/notifications/components/email-preference";
import { CloseAccount } from "../../../../../../../components/accounts/close-account";
import {
	SettingsSection,
	settingsSecondary,
	useSettingsGuard,
} from "../../../../../../../components/accounts/seller-settings-ui";
import { Icon, type IconName } from "../../../../../../../components/ui/icon";
import { Button } from "../../../../../../../components/ui/button";
import { Alert } from "../../../../../../../components/ui/alert";
import { StatusBadge } from "../../../../../../../components/ui/status-badge";

export function SettingsHub({ locale }: { locale: Locale }) {
	const session = useCommunicationSession("seller");
	const seller = useSearchParams().get("seller") ?? "";
	const t = sellerSettingsCopy[locale];
	if (session.loading)
		return (
			<p
				role="status"
				className="rounded-2xl border border-border bg-surface p-6 text-muted"
			>
				{t.loading}
			</p>
		);
	if (!session.session)
		return (
			<div className="space-y-3">
				<Alert variant="danger">
					{accessLost(session.error)
						? authCopy[locale].anonymous
						: authCopy[locale].unavailable}
				</Alert>
				<Link
					className={settingsSecondary}
					href={`/${locale}/auth/seller-sign-in`}
				>
					{authCopy[locale].backSignin}
				</Link>
			</div>
		);
	return (
		<Hub
			key={`${locale}:${session.session.identity.id}:${session.session.accounts[0].id}:${seller}`}
			locale={locale}
			seller={uuidPattern.test(seller) ? seller : null}
		/>
	);
}

function Hub({ locale, seller }: { locale: Locale; seller: string | null }) {
	const t = sellerSettingsCopy[locale],
		o = organizationCopy[locale],
		a = accountSettingsCopy[locale];
	const [profiles, setProfiles] = useState<Profile[] | null>(null);
	const [loading, setLoading] = useState(true),
		[busy, setBusy] = useState(false);
	const [error, setError] = useState(""),
		[fields, setFields] = useState<string[]>([]),
		[notice, setNotice] = useState("");
	const [create, setCreate] = useState(false),
		[companyDirty, setCompanyDirty] = useState(false),
		[emailDirty, setEmailDirty] = useState(false);
	const live = useRef<object | null>(null),
		reading = useRef(0),
		writing = useRef<object | null>(null);
	const guard = useSettingsGuard(locale, companyDirty || emailDirty);
	const load = useCallback(async () => {
		const owner = live.current,
			generation = ++reading.current;
		setLoading(true);
		setError("");
		try {
			const result = await orgRequest<{ profiles: Profile[] }>(
				profilePath("seller"),
				undefined,
				"GET",
			);
			if (owner && live.current === owner && reading.current === generation)
				setProfiles(
					result.profiles.filter((profile) => profile.kind === "company"),
				);
		} catch (cause) {
			if (owner && live.current === owner && reading.current === generation) {
				setProfiles(null);
				setError(accessLost(cause) ? o.denied : o.failed);
			}
		} finally {
			if (owner && live.current === owner && reading.current === generation)
				setLoading(false);
		}
	}, [o]);
	useEffect(() => {
		live.current = {};
		void load();
		return () => {
			live.current = null;
			reading.current++;
			writing.current = null;
		};
	}, [load]);
	async function saveCompany(values: Record<string, unknown>) {
		if (writing.current || !live.current) return false;
		const owner = live.current,
			write = {};
		writing.current = write;
		setBusy(true);
		setError("");
		setFields([]);
		setNotice("");
		try {
			await orgRequest(profilePath("seller"), values);
			if (live.current !== owner || writing.current !== write) return false;
			setCompanyDirty(false);
			setCreate(false);
			setNotice(o.saved);
			await load();
			return true;
		} catch (cause) {
			if (live.current === owner && writing.current === write) {
				setFields(cause instanceof AccountError ? cause.fields : []);
				setError(
					cause instanceof AccountError
						? cause.status === 409
							? o.stale
							: accessLost(cause)
								? o.denied
								: o.invalid
						: o.failed,
				);
				if (accessLost(cause)) {
					setProfiles(null);
					setCreate(false);
					setCompanyDirty(false);
				}
			}
			return false;
		} finally {
			if (live.current === owner && writing.current === write) {
				writing.current = null;
				setBusy(false);
			}
		}
	}
	function destination(
		path: string,
		title: string,
		help: string,
		icon: IconName,
	) {
		return (
			<Link
				href={sellerHref(locale, path, seller)}
				className="group flex min-w-0 items-start gap-3 rounded-xl border border-border bg-surface p-4 text-foreground no-underline transition-colors hover:border-action hover:bg-info motion-reduce:transition-none"
			>
				<span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-page text-action">
					<Icon name={icon} />
				</span>
				<span className="min-w-0 flex-1">
					<span className="block text-base font-semibold">{title}</span>
					<span className="mt-1 block text-sm leading-relaxed text-muted">
						{help}
					</span>
				</span>
				<Icon
					name="chevron"
					className="mt-2 size-4 text-muted group-hover:text-action"
				/>
			</Link>
		);
	}
	return (
		<div className="space-y-6">
			{guard.feedback}
			<SettingsSection
				title={t.account}
				description={t.personalHelp}
				icon="user-circle"
			>
				<div className="grid gap-3 md:grid-cols-3">
					{destination("profile", t.profile, t.profileHelp, "user-circle")}
					{destination("password", t.password, t.passwordHelp, "shield-lock")}
					{destination("link", t.link, t.linkHelp, "link")}
				</div>
				<a
					href="#email-notifications"
					className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-action no-underline"
				>
					<Icon name="mail" className="size-4" />
					{t.notifications}
					<Icon name="arrow-down" className="size-4" />
				</a>
			</SettingsSection>
			<EmailPreference
				locale={locale}
				context="seller"
				sellerSettings
				onDirtyChange={setEmailDirty}
				onNavigate={guard.choose}
			/>
			<SettingsSection
				title={t.business}
				description={t.businessHelp}
				icon="store"
			>
				<div className="grid gap-3 md:grid-cols-2">
					{destination("settings/store", t.store, t.storeHelp, "store")}
					{destination(
						"settings/checkout",
						t.checkout,
						t.checkoutHelp,
						"truck",
					)}
				</div>
				<p className="text-sm leading-relaxed text-muted">{t.permission}</p>
			</SettingsSection>
			<SettingsSection
				id="companies"
				title={t.company}
				description={t.companyHelp}
				icon="team"
				actions={
					<Link
						className={settingsSecondary}
						href={sellerHref(locale, "organizations", seller)}
					>
						{t.manage}
						<Icon name="arrow" className="size-4" />
					</Link>
				}
			>
				{loading && (
					<p role="status" className="text-muted">
						{o.loading}
					</p>
				)}
				{error && (
					<div className="space-y-3">
						<Alert variant="danger" role="alert">
							{error}
						</Alert>
						<Button
							variant="secondary"
							disabled={busy}
							onClick={() =>
								guard.choose(() => {
									setCompanyDirty(false);
									setCreate(false);
									setFields([]);
									void load();
								})
							}
						>
							{t.reload}
						</Button>
					</div>
				)}
				{notice && (
					<Alert variant="success" role="status">
						{notice}
					</Alert>
				)}
				{profiles && (
					<>
						{profiles.length ? (
							<ul className="grid gap-3 md:grid-cols-2">
								{profiles.map((profile) => (
									<li key={profile.id}>
										<Link
											href={sellerHref(
												locale,
												`organizations/${profile.id}`,
												profile.id,
											)}
											className="flex min-h-14 min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4 text-foreground no-underline hover:bg-info"
										>
											<span className="min-w-0 font-medium wrap-anywhere">
												<bdi>{profile.display_name}</bdi>
											</span>
											<span className="flex shrink-0 items-center gap-2">
												<StatusBadge>
													{o[profile.review_status as keyof typeof o] ??
														o.fields}
												</StatusBadge>
												<Icon name="chevron" className="size-4 text-muted" />
											</span>
										</Link>
									</li>
								))}
							</ul>
						) : (
							<p className="rounded-xl bg-page p-4 text-sm text-muted">
								{t.empty}
							</p>
						)}
						<div className="border-t border-border pt-4">
							<Button
								variant="secondary"
								disabled={busy}
								aria-expanded={create}
								aria-controls="seller-company-create"
								onClick={() => {
									if (create && companyDirty)
										guard.choose(() => {
											setCreate(false);
											setCompanyDirty(false);
										});
									else setCreate(!create);
								}}
							>
								<Icon name={create ? "close" : "plus"} />
								{create ? t.cancel : a.create}
							</Button>
						</div>
						{create && (
							<div id="seller-company-create" className="space-y-5">
								<p className="max-w-3xl text-sm leading-relaxed text-muted">
									{a.description}
								</p>
								<ProfileEditor
									locale={locale}
									context="seller"
									kinds={["company"]}
									sellerSettings
									busy={busy}
									errors={fields}
									onDirtyChange={setCompanyDirty}
									onSave={saveCompany}
								/>
							</div>
						)}
					</>
				)}
			</SettingsSection>
			<SettingsSection
				id="privacy"
				title={t.privacy}
				description={t.privacyHelp}
				icon="lock"
			>
				<Link className={settingsSecondary} href={`/${locale}/privacy`}>
					{t.policy}
					<Icon name="arrow" className="size-4" />
				</Link>
			</SettingsSection>
			<CloseAccount locale={locale} context="seller" />
		</div>
	);
}
