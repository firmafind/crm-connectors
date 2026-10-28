/** Company-created inputs: companyName = trigger.properties.after.name,
 * companyId = trigger.properties.after.id; apiKey comes from configuration.
 * Paste this entire file into the first Code action. No FN input is needed.
 */
export const main = async (params: {
	companyId: string;
	companyName: string;
	apiKey: string;
}) => {
	if (typeof params.companyId !== "string" || !params.companyId.trim()) {
		throw new Error("Twenty company ID is required.");
	}
	const normalizeFnr = (value: string) =>
		value
			.trim()
			.replace(/^fn-?\s*/i, "")
			.replace(/\s+/g, "")
			.toLowerCase();
	const normalizeName = (value: string) =>
		value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
	const result = (status: "matched" | "not_found" | "ambiguous", fnr = "") => ({
		status,
		matched: status === "matched",
		companyId: params.companyId.trim(),
		fnr,
	});
	if (typeof params.companyName !== "string" || !params.companyName.trim()) {
		throw new Error("A company name is required.");
	}
	if (typeof params.apiKey !== "string" || !params.apiKey.trim()) {
		throw new Error("firmafind API key is required.");
	}
	const url = new URL("https://firmafind.at/api/companies");
	url.searchParams.set("name", params.companyName.trim());
	url.searchParams.set("exact", "true");
	const response = await fetch(url.toString(), {
		headers: { "x-api-key": params.apiKey.trim() },
		redirect: "error",
		signal: AbortSignal.timeout(20000),
	});
	if (!response.ok)
		throw new Error(`firmafind search failed (HTTP ${response.status}).`);
	const payload = await response.json();
	if (!Array.isArray(payload?.data))
		throw new Error("Unexpected firmafind search response.");
	const matches = new Set<string>();
	for (const company of payload.data) {
		if (
			!company ||
			typeof company.name !== "string" ||
			typeof company.fnr !== "string"
		) {
			throw new Error("Invalid firmafind search result.");
		}
		const fnr = normalizeFnr(company.fnr);
		if (!/^\d{1,6}[a-z]$/.test(fnr))
			throw new Error("Invalid FN in firmafind search result.");
		if (normalizeName(company.name) === normalizeName(params.companyName))
			matches.add(fnr);
	}
	if (matches.size === 0) return result("not_found");
	if (matches.size !== 1) return result("ambiguous");
	return result("matched", [...matches][0]);
};
