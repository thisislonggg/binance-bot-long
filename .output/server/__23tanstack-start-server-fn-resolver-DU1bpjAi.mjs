//#region node_modules/.nitro/vite/services/ssr/assets/__23tanstack-start-server-fn-resolver-DU1bpjAi.js
var manifest = { "7cd60a3b126682b15fe72609b4818883cf6dfa58fe383f03d92d37359a36dc7d": {
	functionName: "getMarketSnapshot_createServerFn_handler",
	importer: () => import("./_ssr/p2p.functions-CeUxwZ-z.mjs")
} };
async function getServerFnById(id, access) {
	const serverFnInfo = manifest[id];
	if (!serverFnInfo) throw new Error("Server function info not found for " + id);
	const fnModule = serverFnInfo.module ?? await serverFnInfo.importer();
	if (!fnModule) throw new Error("Server function module not resolved for " + id);
	const action = fnModule[serverFnInfo.functionName];
	if (!action) throw new Error("Server function module export not resolved for serverFn ID: " + id);
	return action;
}
//#endregion
export { getServerFnById as t };
