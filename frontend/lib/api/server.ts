import "server-only";
import {
	ApiError,
	getBootstrap,
	type Bootstrap,
	type ApiFailure,
} from "./client";
export async function serverBootstrap(): Promise<{
	data: Bootstrap | null;
	failure: ApiFailure | null;
}> {
	try {
		return {
			data: await getBootstrap(process.env.API_INTERNAL_URL),
			failure: null,
		};
	} catch (error) {
		return {
			data: null,
			failure: error instanceof ApiError ? error.kind : "unavailable",
		};
	}
}
