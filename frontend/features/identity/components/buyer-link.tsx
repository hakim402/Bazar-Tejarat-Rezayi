"use client";
import Link from "next/link";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type FormEvent,
} from "react";
import toast from "react-hot-toast";
import { GoogleButton } from "../../../components/authentication/google-entry";
import { Button } from "../../../components/shadcn/button";
import { Card } from "../../../components/shadcn/card";
import { Input } from "../../../components/shadcn/input";
import { Alert } from "../../../components/ui/alert";
import { FormActions, FormField } from "../../../components/ui/dialog-form";
import { Icon } from "../../../components/ui/icon";
import { StatusBadge } from "../../../components/ui/status-badge";
import { authCopy } from "../../../lib/i18n/auth";
import { buyerShellCopy } from "../../../lib/i18n/buyer-shell";
import { googleCopy } from "../../../lib/i18n/google";
import type { Locale } from "../../../lib/i18n/locales";
import { salesTableCard } from "../../sales/components/seller-sales-ui";
import {
	AccountError,
	accountSession,
	authMutation,
	type SessionData,
} from "../api/accounts";

// Become-a-seller workspace: the buyer session stays visible while the two
// confirmation paths (password, Google) sit side by side as flat cards.
export function BuyerLinkPanel({ locale }: { locale: Locale }) {
	const t = authCopy[locale],
		g = googleCopy[locale],
		shell = buyerShellCopy[locale];
	const [data, setData] = useState<SessionData | null>(null),
		[loading, setLoading] = useState(true),
		[error, setError] = useState(""),
		[formError, setFormError] = useState(""),
		[busy, setBusy] = useState(false),
		[password, setPassword] = useState(""),
		[linked, setLinked] = useState(false);
	const inFlight = useRef(false);
	const refresh = useCallback(async () => {
		try {
			setData(await accountSession("buyer"));
			setError("");
		} catch (err) {
			setData(null);
			setError(
				err instanceof AccountError && err.status === 403
					? t.anonymous
					: t.unavailable,
			);
		} finally {
			setLoading(false);
		}
	}, [t]);
	useEffect(() => {
		let current = true;
		const load = () => {
			if (current) void refresh();
		};
		load();
		window.addEventListener("focus", load);
		return () => {
			current = false;
			window.removeEventListener("focus", load);
		};
	}, [refresh]);
	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (inFlight.current) return;
		inFlight.current = true;
		setBusy(true);
		setFormError("");
		try {
			await authMutation("buyer/link/seller/", { password });
			setPassword("");
			setLinked(true);
			toast.success(t.linked);
		} catch (err) {
			const message =
				err instanceof AccountError
					? err.status === 429
						? t.limited
						: err.code === "csrf_failed"
							? t.stale
							: err.status === 403
								? t.denied
								: t.invalid
					: t.unavailable;
			setFormError(message);
			toast.error(message);
		} finally {
			inFlight.current = false;
			setBusy(false);
		}
	}
	return (
		<div className="space-y-6">
			<div>
				<h1 className="m-0 text-xl font-semibold tracking-tight">
					{shell.becomeSeller}
				</h1>
				<p className="m-0 mt-1 text-sm text-muted">{t.linkIntro}</p>
			</div>
			{loading && (
				<p role="status" className="m-0 text-sm text-muted">
					{t.loading}
				</p>
			)}
			{error && (
				<Alert variant="danger" role="alert">
					{error}
				</Alert>
			)}
			{!data && !loading && (
				<div className="flex flex-wrap gap-2">
					<Button type="button" variant="secondary" size="sm" onClick={refresh}>
						{t.retry}
					</Button>
					<Button asChild variant="outline" size="sm">
						<Link href={`/${locale}/auth/buyer-sign-in`} prefetch={false}>
							{t.backSignin}
						</Link>
					</Button>
				</div>
			)}
			{data && (
				<>
					<Card className={salesTableCard}>
						<div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
							<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-page text-muted">
								<Icon name="user-circle" className="size-4" />
							</span>
							<div className="min-w-0 flex-1">
								<p className="m-0 truncate text-sm font-medium">
									{data.identity.display_name || data.identity.email}
								</p>
								<p className="m-0 truncate text-xs text-muted">
									<bdi dir="ltr">{data.identity.email}</bdi>
								</p>
							</div>
							<StatusBadge
								size="sm"
								dot={false}
								variant={data.identity.email_verified ? "success" : "warning"}
							>
								{data.identity.email_verified ? t.verifiedLabel : t.verify}
							</StatusBadge>
						</div>
					</Card>
					{linked ? (
						<Card className={salesTableCard}>
							<div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
								<div className="flex min-w-0 items-center gap-3">
									<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-success-surface text-success">
										<Icon name="check" className="size-4" />
									</span>
									<p className="m-0 text-sm">{t.linkDone}</p>
								</div>
								<Button asChild size="sm" className="shrink-0 gap-2">
									<Link
										href={`/${locale}/auth/seller-sign-in`}
										prefetch={false}
									>
										{t.seller} · {t.signin}
										<Icon
											name="chevron"
											className="size-3.5 rtl:-scale-x-100"
										/>
									</Link>
								</Button>
							</div>
						</Card>
					) : (
						<div className="grid items-start gap-6 lg:grid-cols-2">
							<Card className={salesTableCard}>
								<div className="border-0 border-b border-solid border-border px-4 py-3 sm:px-5">
									<h2 className="m-0 text-sm font-semibold">
										{t.linkPassword}
									</h2>
									<p className="m-0 mt-0.5 text-xs text-muted">{t.linkHelp}</p>
								</div>
								<form
									onSubmit={submit}
									className="space-y-4 px-4 py-4 sm:px-5"
									aria-busy={busy}
								>
									{formError && (
										<Alert role="alert" className="m-0 text-sm">
											{formError}
										</Alert>
									)}
									<FormField
										id="buyer-link-password"
										label={t.currentPassword}
										required
									>
										<Input
											id="buyer-link-password"
											name="password"
											type="password"
											dir="ltr"
											required
											maxLength={128}
											autoComplete="current-password"
											value={password}
											onChange={(event) => setPassword(event.target.value)}
											disabled={busy}
										/>
									</FormField>
									<FormActions>
										<Button type="submit" disabled={busy}>
											{busy ? t.saving : t.submit}
										</Button>
									</FormActions>
								</form>
							</Card>
							<Card className={salesTableCard}>
								<div className="border-0 border-b border-solid border-border px-4 py-3 sm:px-5">
									<h2 className="m-0 text-sm font-semibold">{g.button}</h2>
									<p className="m-0 mt-0.5 text-xs text-muted">{g.addRole}</p>
								</div>
								<div className="px-4 py-4 sm:px-5">
									<GoogleButton
										locale={locale}
										context="seller"
										sourceContext="buyer"
										action="add-role"
										embedded
									/>
								</div>
							</Card>
						</div>
					)}
				</>
			)}
		</div>
	);
}
