"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { authMutation } from "../../identity/api/accounts";
import { Button } from "../../../components/ui/button";
import { Alert } from "../../../components/ui/alert";
import type { Locale } from "../../../lib/i18n/locales";
import { organizationCopy, label } from "../../../lib/i18n/organizations";
import { type InvitePreview, orgRequest } from "../api/organizations";
const KEY = "rezayi-company-invitation";
function storedInvitation() {
	try {
		const stored = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
		return stored &&
			stored.until > Date.now() &&
			typeof stored.token === "string"
			? stored.token
			: "";
	} catch {
		return "";
	}
}
export function InvitationReturn({ locale }: { locale: Locale }) {
	const [pending, setPending] = useState(false);
	useEffect(() => {
		setPending(Boolean(storedInvitation()));
	}, []);
	return pending ? (
		<Link className="my-3 block text-action" href={`/${locale}/invitation`}>
			{organizationCopy[locale].returnInvite}
		</Link>
	) : null;
}
export function InvitationEntry({ locale }: { locale: Locale }) {
	const t = organizationCopy[locale];
	const [token, setToken] = useState("");
	const [data, setData] = useState<InvitePreview | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	useEffect(() => {
		const fragment = new URLSearchParams(window.location.hash.slice(1));
		const incoming = fragment.get("token");
		history.replaceState(null, "", window.location.pathname);
		const raw =
			incoming && /^[A-Za-z0-9_-]{40,100}$/.test(incoming)
				? incoming
				: storedInvitation();
		if (raw) {
			sessionStorage.setItem(
				KEY,
				JSON.stringify({ token: raw, until: Date.now() + 30 * 60 * 1000 }),
			);
			setToken(raw);
		} else setData({ status: "unavailable" });
	}, []);
	useEffect(() => {
		if (!token) return;
		let active = true;
		setBusy(true);
		orgRequest<InvitePreview>("organizations/invitations/preview/", { token })
			.then((result) => {
				if (active) {
					setData(result);
					if (result.status === "unavailable") sessionStorage.removeItem(KEY);
				}
			})
			.catch(() => {
				if (active) setError(t.failed);
			})
			.finally(() => {
				if (active) setBusy(false);
			});
		return () => {
			active = false;
		};
	}, [token, t]);
	async function accept() {
		setBusy(true);
		setError("");
		try {
			await orgRequest("organizations/invitations/accept/", { token });
			sessionStorage.removeItem(KEY);
			setToken("");
			setData({ status: "accepted" });
		} catch {
			setError(t.invalid);
		} finally {
			setBusy(false);
		}
	}
	const returnPath = `/${locale}/invitation`;
	const next = encodeURIComponent(returnPath);
	const state = data?.status;
	return (
		<>
			<h1 className="text-3xl font-bold">
				{state === "unavailable" ? t.unavailable : t.invitationTitle}
			</h1>
			<p className="my-4 text-muted">{t.invitationHelp}</p>
			{busy && <p role="status">{t.loading}</p>}
			{error && (
				<>
					<Alert>{error}</Alert>
					<Button variant="secondary" onClick={() => window.location.reload()}>
						{t.retry}
					</Button>
				</>
			)}
			{data && (
				<>
					{state === "unavailable" ? (
						<p role="status" className="my-5 rounded-card bg-info p-4">
							{t.inviteUnavailable}
						</p>
					) : state === "accepted" ? (
						<p
							role="status"
							className="my-5 rounded-card bg-success-surface p-4 text-success"
						>
							{t.joined}
						</p>
					) : state === "pending" ? (
						<>
							<h2 className="my-4 break-words text-2xl font-bold">
								{data.company_name}
							</h2>
							<bdi className="font-identifier">{data.invited_hint}</bdi>
							<ul className="my-5">
								{data.bundles?.map((bundle) => (
									<li key={bundle}>{label(t, bundle)}</li>
								))}
							</ul>
							<p className="my-4">{t.privateHelp}</p>
							<Button disabled={busy} onClick={accept}>
								{t.accept}
							</Button>
						</>
					) : (
						<>
							<p role="status" className="my-5">
								{state === "wrong_account"
									? t.wrong_account
									: t.signin_required}
							</p>
							{state === "wrong_account" && (
								<Button
									variant="secondary"
									onClick={async () => {
										await authMutation("logout-all/");
										window.location.reload();
									}}
								>
									{t.signin}
								</Button>
							)}
							<nav className="my-4 flex flex-col gap-4 text-action">
								<Link href={`/${locale}/auth/seller-sign-in?return=${next}`}>
									{t.signin}
								</Link>
								<Link
									href={`/${locale}/auth/seller-registration?return=${next}`}
								>
									{t.signup}
								</Link>
								<Link href={`/${locale}/account/buyer/link`}>{t.link}</Link>
							</nav>
						</>
					)}
					<Link
						className="my-5 block text-action"
						href={`/${locale}/account/seller/organizations`}
					>
						{t.select}
					</Link>
				</>
			)}
		</>
	);
}
