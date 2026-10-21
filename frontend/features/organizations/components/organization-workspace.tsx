"use client";
import Link from "next/link";
import { useState } from "react";
import { organizationCopy, label } from "../../../lib/i18n/organizations";
import type { Locale } from "../../../lib/i18n/locales";
import { Button } from "../../../components/ui/button";
import { ApplicationPanel } from "../../verification/components/application-panel";
import { profilePath, type Profile } from "../api/organizations";
import { ProfileEditor } from "./profile-editor";
import { TeamPanel } from "./team-panel";
import { useWorkflow, WorkflowState, WorkspaceNav } from "./workflow-state";
export function OrganizationWorkspace({
	locale,
	context,
	profileId,
}: {
	locale: Locale;
	context: string;
	profileId?: string;
}) {
	const state = useWorkflow<{ profiles: Profile[] }>(
		profilePath(context),
		locale,
	);
	const t = organizationCopy[locale];
	const [tab, setTab] = useState("profile");
	const selected = state.data?.profiles.find((p) => p.id === profileId);
	const base = `/${locale}/account/${context}/organizations`;
	return (
		<>
			<h1 className="text-3xl font-bold">{t.title}</h1>
			<WorkspaceNav locale={locale} context={context} />
			<WorkflowState state={state} locale={locale} />
			{state.data &&
				(!profileId ? (
					<>
						<h2 className="my-4 text-xl font-bold">{t.select}</h2>
						<ul className="list-none p-0 my-5 flex flex-col gap-4">
							{state.data.profiles.map((profile) => (
								<li
									key={profile.id}
									className="rounded-card border border-border p-4"
								>
									<Link
										className="break-words text-xl font-bold text-action"
										href={`${base}/${profile.id}`}
									>
										{profile.display_name}
									</Link>
									<p>
										{t[profile.kind as "individual" | "company" | "business"]} ·{" "}
										{label(t, profile.review_status)}
									</p>
								</li>
							))}
						</ul>
						{!state.data.profiles.length && <p>{t.empty}</p>}
						<details className="my-4" open={!state.data.profiles.length}>
							<summary className="cursor-pointer py-3 text-xl font-bold">
								{t.create}
							</summary>
							<ProfileEditor
								locale={locale}
								context={context}
								busy={state.busy}
								errors={state.fields}
								onSave={(data) => state.mutate(profilePath(context), data)}
							/>
						</details>
					</>
				) : selected ? (
					<>
						<h2 className="break-words text-2xl font-bold">
							{selected.display_name}
						</h2>
						<p className="my-3" data-testid="profile-entitlement">
							{t.entitlement}:{" "}
							<strong>
								{selected.entitlement ? t.eligible : t.ineligible}
							</strong>
						</p>
						<p className="text-muted">{t.emailVerified}</p>
						<nav className="my-5 flex flex-wrap gap-3">
							{(selected.can_manage
								? [
										"profile",
										"application",
										...(selected.kind === "company" ? ["team"] : []),
									]
								: ["team"]
							).map((key) => (
								<Button
									key={key}
									variant={tab === key ? "primary" : "secondary"}
									onClick={() => setTab(key)}
								>
									{t[key as "profile" | "application" | "team"]}
								</Button>
							))}
						</nav>
						{selected.can_manage && tab === "profile" && (
							<ProfileEditor
								key={selected.version}
								locale={locale}
								context={context}
								profile={selected}
								busy={state.busy}
								errors={state.fields}
								onSave={(data) =>
									state.mutate(profilePath(context, selected.id), data, "PATCH")
								}
							/>
						)}
						{selected.can_manage && tab === "application" && (
							<ApplicationPanel
								locale={locale}
								context={context}
								profileId={selected.id}
								onChanged={state.refresh}
							/>
						)}
						{selected.kind === "company" &&
							(tab === "team" || !selected.can_manage) && (
								<TeamPanel
									locale={locale}
									context={context}
									profile={selected}
									onChanged={state.refresh}
								/>
							)}
					</>
				) : (
					<p role="alert">{t.denied}</p>
				))}
		</>
	);
}
