/** Copy this entire file into a Twenty workflow Code action. No dependencies. */
export const main = async (params: {
	fnr: string;
	apiKey: string;
	companyId?: string;
}) => {
	const normalize = (value: string) =>
		value
			.trim()
			.replace(/^FN-?\s*/i, "")
			.replace(/\s+/g, "")
			.toLowerCase();
	const fnr = typeof params.fnr === "string" ? normalize(params.fnr) : "";
	if (!/^\d{1,6}[a-z]$/.test(fnr)) {
		throw new Error("Firmenbuchnummer erforderlich, z. B. FN 123456 a.");
	}
	if (typeof params.apiKey !== "string" || !params.apiKey.trim()) {
		throw new Error("firmafind API-Key fehlt.");
	}

	// Fixed origin: credentials cannot be forwarded to an input-controlled URL.
	const response = await fetch(`https://firmafind.at/api/companies/${fnr}`, {
		headers: { "x-api-key": params.apiKey.trim() },
		redirect: "error",
		signal: AbortSignal.timeout(20000),
	});
	if (!response.ok) {
		const messages: Record<number, string> = {
			401: "firmafind API-Key ungültig.",
			402: "firmafind Credits aufgebraucht.",
			403: "Zugriff auf diese Firma gesperrt.",
			404: "Firma oder Endpunkt nicht gefunden.",
			429: "firmafind Abfragelimit erreicht; später erneut versuchen.",
		};
		// Do not echo upstream bodies or credentials into workflow errors.
		throw new Error(
			messages[response.status] ??
				`firmafind Abfrage fehlgeschlagen (HTTP ${response.status}).`,
		);
	}
	const payload = await response.json();
	const data = payload?.data;
	if (
		!data ||
		typeof data.fnr !== "string" ||
		normalize(data.fnr) !== fnr ||
		typeof data.companyName !== "string" ||
		!data.companyName.trim() ||
		typeof data.isActive !== "boolean" ||
		!Array.isArray(data.management)
	) {
		throw new Error(
			"Unerwartete firmafind Antwort; CRM-Daten wurden nicht geändert.",
		);
	}

	const directors: { fullName: string; role: string }[] = [];
	const seen = new Set<string>();
	for (const entry of data.management) {
		if (
			!entry ||
			typeof entry.name !== "string" ||
			typeof entry.role !== "string"
		) {
			throw new Error(
				"Ungültige Managementdaten; CRM-Daten wurden nicht geändert.",
			);
		}
		// Register management also contains shareholders, proxies and board members.
		// Preserve the supplied full name rather than guessing first/last names.
		const role = entry.role.normalize("NFKC").trim();
		if (!/\bgesch(?:ä|ae)ftsf(?:ü|ue)hrer(?:in|\/in)?\b/i.test(role)) continue;
		const fullName = entry.name.trim();
		if (!fullName || /^(unknown|error loading)$/i.test(fullName)) {
			throw new Error(
				"Geschäftsführername fehlt; CRM-Daten wurden nicht geändert.",
			);
		}
		const key = `${fullName.toLowerCase()}\u0000${role.toLowerCase()}`;
		if (seen.has(key)) continue;
		seen.add(key);
		directors.push({ fullName, role });
	}

	return {
		companyId: params.companyId ?? "",
		fnr,
		companyName: data.companyName.trim(),
		isActive: data.isActive,
		shouldUpdate: data.isActive,
		directors,
		directorCount: directors.length,
		// An empty list is a valid register result, not a failed lookup.
		managingDirectorsText: directors
			.map((person) => person.fullName)
			.join("\n"),
		sourceUrl: `https://firmafind.at/api/companies/${fnr}`,
	};
};
