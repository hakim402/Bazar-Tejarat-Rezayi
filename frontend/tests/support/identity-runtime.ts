import { execFileSync } from "node:child_process";

export const identityTestsEnabled = process.env.IDENTITY_BROWSER_TESTS === "1";
export const apiOrigin = process.env.PLAYWRIGHT_API_ORIGIN ?? "http://127.0.0.1:8100";
export const fixturePassword = process.env.REZAYI_TEST_FIXTURE_PASSWORD ?? "";

export function disposablePython(script: string, input?: string) {
	const id = process.env.REZAYI_TEST_RUN_ID ?? "";
	const project = process.env.REZAYI_TEST_PROJECT ?? "";
	const python = process.env.REZAYI_TEST_PYTHON ?? "";
	if (!/^[0-9a-f]{16}$/.test(id) || project !== `rezayi-test-${id}` || !fixturePassword || !python)
		throw new Error("Use python3 backend/scripts/run_tests.py to prepare disposable tests.");
	const guard = "import os\nimport django;django.setup()\nfrom django.db import connection\nfrom config.testing import assert_owned_database\nassert_owned_database(connection)\n";
	try {
		return execFileSync(python, ["-c", guard + script],
			{ cwd: "../backend", env: process.env, timeout: 20000, input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
	} catch {
		throw new Error("Disposable test helper failed; private command output withheld.");
	}
}
