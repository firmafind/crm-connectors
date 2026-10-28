import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { main as lookup } from "./lookup";
import { main as prepare } from "./prepare-people";
import { main as resolve } from "./resolve-company";

afterEach(() => mock.restoreAll());
const company = {
	companyId: "twenty-company",
	companyName: "Beispiel GmbH",
	apiKey: "test-secret",
};
const director = { fullName: "Alex Beispiel", role: "Geschäftsführer" };
const existingPerson = {
	id: "existing-person",
	companyId: company.companyId,
	name: { firstName: "Alex", lastName: "Beispiel" },
};
const searchResult = { name: company.companyName, fnr: "123456a" };

test("missing company ID, name or API key never makes a request", async () => {
	const request = mock.method(globalThis, "fetch");
	await assert.rejects(resolve({ ...company, companyId: "" }), /company ID/);
	await assert.rejects(
		resolve({ ...company, companyName: "" }),
		/company name/,
	);
	await assert.rejects(resolve({ ...company, apiKey: "" }), /API key/);
	await assert.rejects(
		resolve({ ...company, companyName: "  " }),
		/company name/,
	);
	assert.equal(request.mock.callCount(), 0);
});

test("always resolves by name even when an old workflow still passes an FN", async () => {
	const request = mock.method(globalThis, "fetch", async () =>
		Response.json({ data: [searchResult] }),
	);
	const legacyInputs = { ...company, fnr: "999b" };
	const result = await resolve(legacyInputs);
	assert.equal(result.fnr, "123456a");
	assert.equal(result.companyId, company.companyId);
	assert.equal(request.mock.callCount(), 1);
	assert.equal(
		new URL(String(request.mock.calls[0].arguments[0])).searchParams.get(
			"name",
		),
		company.companyName,
	);
});

test("resolves only an exact normalized name and encodes the query", async () => {
	const request = mock.method(globalThis, "fetch", async () =>
		Response.json({
			data: [
				{ ...searchResult, name: "  BEISPIEL   GmbH " },
				{ ...searchResult, name: "Beispiel GmbH & Co KG", fnr: "999b" },
				searchResult,
			],
		}),
	);
	const result = await resolve(company);
	assert.equal(result.matched, true);
	assert.equal(result.fnr, "123456a");
	const url = new URL(String(request.mock.calls[0].arguments[0]));
	assert.equal(url.origin, "https://firmafind.at");
	assert.equal(url.searchParams.get("name"), company.companyName);
	assert.equal(url.searchParams.get("exact"), "true");
	assert.doesNotMatch(JSON.stringify(result), /test-secret/);
});

test("no match and ambiguous names never select an arbitrary FN", async () => {
	for (const [data, expected] of [
		[[], "not_found"],
		[[{ ...searchResult, name: "Different GmbH" }], "not_found"],
		[[searchResult, { ...searchResult, fnr: "999b" }], "ambiguous"],
	] as const) {
		mock.method(globalThis, "fetch", async () => Response.json({ data }));
		const result = await resolve(company);
		assert.equal(result.status, expected);
		assert.equal(result.matched, false);
		assert.equal(result.fnr, "");
		mock.restoreAll();
	}
});

test("search fails closed on upstream errors and malformed data", async () => {
	for (const body of [
		{},
		{ data: null },
		{ data: [null] },
		{ data: [{ ...searchResult, fnr: "bad" }] },
	]) {
		mock.method(globalThis, "fetch", async () => Response.json(body));
		await assert.rejects(resolve(company));
		mock.restoreAll();
	}
	mock.method(
		globalThis,
		"fetch",
		async () => new Response("test-secret", { status: 429 }),
	);
	await assert.rejects(resolve(company), (error: Error) => {
		assert.match(error.message, /HTTP 429/);
		assert.doesNotMatch(error.message, /test-secret/);
		return true;
	});
});

test("skips existing split/full names and deduplicates directors across roles", async () => {
	const result = await prepare({
		companyId: company.companyId,
		directors: [
			director,
			{ fullName: "  KIM   MUSTER ", role: "Geschäftsführerin" },
			{ fullName: "Kim Muster", role: "Geschäftsführer" },
		],
		existingPeople: [existingPerson],
		existingPeopleTotalCount: 1,
	});
	assert.equal(result.createCount, 1);
	assert.deepEqual(result.peopleToCreate[0], {
		companyId: company.companyId,
		firstName: "",
		lastName: "KIM   MUSTER",
		fullName: "KIM   MUSTER",
		jobTitle: "Geschäftsführerin",
	});
});

test("incomplete searches and wrong-company results cannot create People", async () => {
	const inputs = {
		companyId: company.companyId,
		directors: [director],
		existingPeople: [existingPerson],
		existingPeopleTotalCount: 1,
	};
	await assert.rejects(
		prepare({ ...inputs, existingPeopleTotalCount: 2 }),
		/incomplete/,
	);
	await assert.rejects(
		prepare({ ...inputs, existingPeopleTotalCount: -1 }),
		/incomplete/,
	);
	await assert.rejects(
		prepare({
			...inputs,
			existingPeople: [{ ...existingPerson, companyId: "other-company" }],
		}),
		/triggering company/,
	);
	await assert.rejects(
		prepare({ ...inputs, directors: [{ ...director, role: "Prokurist" }] }),
		/Invalid managing director/,
	);
	assert.equal((await prepare({ ...inputs, directors: [] })).createCount, 0);
});

test("company-created pipeline produces linked People and skips them on a full rerun", async () => {
	const requests = mock.method(
		globalThis,
		"fetch",
		async (input: string | URL | Request) => {
			const url = new URL(String(input));
			if (url.pathname === "/api/companies")
				return Response.json({ data: [searchResult] });
			assert.equal(url.pathname, "/api/companies/123456a");
			return Response.json({
				data: {
					fnr: "123456a",
					companyName: company.companyName,
					isActive: true,
					management: [
						{ name: director.fullName, role: director.role },
						{ name: "Proxy Person", role: "Prokurist" },
					],
				},
			});
		},
	);
	const resolved = await resolve(company);
	assert.equal(resolved.matched, true);
	const details = await lookup({ ...resolved, apiKey: company.apiKey });
	assert.equal(details.shouldUpdate, true);
	const plan = await prepare({
		companyId: details.companyId,
		directors: details.directors,
		existingPeople: [],
		existingPeopleTotalCount: 0,
	});
	assert.equal(plan.createCount, 1);
	const createdPeople = plan.peopleToCreate.map((person) => ({
		id: "created-person",
		companyId: person.companyId,
		name: { firstName: person.firstName, lastName: person.lastName },
	}));
	assert.equal(
		(
			await prepare({
				companyId: details.companyId,
				directors: details.directors,
				existingPeople: createdPeople,
				existingPeopleTotalCount: 1,
			})
		).createCount,
		0,
	);
	assert.equal(requests.mock.callCount(), 2);
});
