/** Paste this entire file into a Code action after Search Records → People. */
export const main = async (params: {
	companyId: string;
	directors: { fullName: string; role: string }[];
	existingPeople: {
		id: string;
		companyId: string;
		name: { firstName?: string | null; lastName?: string | null };
	}[];
	existingPeopleTotalCount: number;
}) => {
	if (typeof params.companyId !== "string" || !params.companyId.trim()) {
		throw new Error("Twenty company ID is required.");
	}
	if (
		!Array.isArray(params.directors) ||
		!Array.isArray(params.existingPeople)
	) {
		throw new Error("Map directors and Search Records → All as arrays.");
	}
	// Never assume the first search page contains every existing person.
	if (
		!Number.isInteger(params.existingPeopleTotalCount) ||
		params.existingPeopleTotalCount !== params.existingPeople.length
	) {
		throw new Error(
			"People search is incomplete. Fetch all pages before creating People.",
		);
	}
	const normalize = (value: string) =>
		value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
	const seen = new Set<string>();
	for (const person of params.existingPeople) {
		if (
			!person ||
			typeof person.id !== "string" ||
			person.companyId !== params.companyId ||
			!person.name
		) {
			throw new Error(
				"People search must contain only records linked to the triggering company.",
			);
		}
		const firstName = person.name.firstName ?? "";
		const lastName = person.name.lastName ?? "";
		if (typeof firstName !== "string" || typeof lastName !== "string")
			throw new Error("Invalid existing person name.");
		seen.add(normalize(`${firstName} ${lastName}`));
	}
	const peopleToCreate: {
		companyId: string;
		firstName: string;
		lastName: string;
		fullName: string;
		jobTitle: string;
	}[] = [];
	for (const director of params.directors) {
		if (
			!director ||
			typeof director.fullName !== "string" ||
			!director.fullName.trim() ||
			typeof director.role !== "string" ||
			!/\bgesch(?:ä|ae)ftsf(?:ü|ue)hrer(?:in|\/in)?\b/i.test(director.role)
		) {
			throw new Error("Invalid managing director data.");
		}
		const fullName = director.fullName.trim();
		const key = normalize(fullName);
		if (seen.has(key)) continue;
		seen.add(key);
		peopleToCreate.push({
			companyId: params.companyId,
			// firmafind returns a formatted full name, not structured name components.
			firstName: "",
			lastName: fullName,
			fullName,
			jobTitle: director.role.trim(),
		});
	}
	return { peopleToCreate, createCount: peopleToCreate.length };
};
