import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { main } from "./lookup";

const company = {
	fnr: "123456a",
	companyName: "Beispiel GmbH",
	isActive: true,
	management: [
		{ name: "Alex Beispiel", role: "Geschäftsführer" },
		{ name: "Kim Muster", role: "Geschäftsführerin" },
		{ name: "Alex Beispiel", role: "Geschäftsführer" },
		{ name: "Andere Person", role: "Prokurist" },
		{ name: "Weitere Person", role: "Gesellschafter" },
		{ name: "Vorstand Person", role: "Vorstand" },
	],
};
const params = {
	fnr: "FN 123456 A",
	apiKey: "test-key",
	companyId: "company-id",
};
afterEach(() => mock.restoreAll());

test("normalizes FN, authenticates and only returns deduplicated managing directors", async () => {
	const fetchMock = mock.method(globalThis, "fetch", async () =>
		Response.json({ data: { ...company, privateAddress: "excluded" } }),
	);
	const result = await main(params);
	assert.equal(
		fetchMock.mock.calls[0].arguments[0],
		"https://firmafind.at/api/companies/123456a",
	);
	assert.equal(
		new Headers(fetchMock.mock.calls[0].arguments[1]?.headers).get("x-api-key"),
		"test-key",
	);
	assert.equal(result.directorCount, 2);
	assert.equal(result.managingDirectorsText, "Alex Beispiel\nKim Muster");
	assert.equal(result.companyId, "company-id");
	assert.equal(result.shouldUpdate, true);
	assert.doesNotMatch(
		JSON.stringify(result),
		/test-key|privateAddress|excluded/,
	);
});

test("rejects invalid input before making a request", async () => {
	const fetchMock = mock.method(globalThis, "fetch");
	for (const fnr of [
		"",
		"123456",
		"1234567a",
		"https://example.com",
		"123/a",
	]) {
		await assert.rejects(main({ ...params, fnr }), /Firmenbuchnummer/);
	}
	await assert.rejects(main({ ...params, apiKey: " " }), /API-Key fehlt/);
	assert.equal(fetchMock.mock.callCount(), 0);
});

test("supports the FN- prefix and an empty management list", async () => {
	mock.method(globalThis, "fetch", async () =>
		Response.json({ data: { ...company, management: [] } }),
	);
	const result = await main({ ...params, fnr: "fn-123456a" });
	assert.deepEqual(result.directors, []);
	assert.equal(result.managingDirectorsText, "");
});

test("does not mark inactive companies for CRM updates", async () => {
	mock.method(globalThis, "fetch", async () =>
		Response.json({ data: { ...company, isActive: false } }),
	);
	assert.equal((await main(params)).shouldUpdate, false);
});

test("fails closed on malformed, mismatched and incomplete register results", async () => {
	for (const data of [
		null,
		{ ...company, fnr: "111b" },
		{ ...company, management: null },
		{ ...company, management: [{ name: "Unknown", role: "Geschäftsführer" }] },
	]) {
		mock.method(globalThis, "fetch", async () => Response.json({ data }));
		await assert.rejects(main(params));
		mock.restoreAll();
	}
});

test("HTTP failures stop the workflow without leaking response bodies or retrying", async () => {
	for (const status of [400, 401, 402, 403, 404, 429, 500, 503]) {
		const fetchMock = mock.method(
			globalThis,
			"fetch",
			async () => new Response("secret-upstream-body", { status }),
		);
		await assert.rejects(main(params), (error: Error) => {
			assert.doesNotMatch(error.message, /secret-upstream-body|test-key/);
			return true;
		});
		assert.equal(fetchMock.mock.callCount(), 1);
		mock.restoreAll();
	}
});

test("network errors stop execution", async () => {
	mock.method(globalThis, "fetch", async () => {
		throw new Error("network unavailable");
	});
	await assert.rejects(main(params), /network unavailable/);
});

test("supports transliterated roles and rejects malformed JSON", async () => {
	mock.method(globalThis, "fetch", async () =>
		Response.json({
			data: {
				...company,
				management: [{ name: "Test Person", role: "Geschaeftsfuehrer" }],
			},
		}),
	);
	assert.equal((await main(params)).directorCount, 1);
	mock.restoreAll();
	mock.method(globalThis, "fetch", async () => new Response("not-json"));
	await assert.rejects(main(params));
});
