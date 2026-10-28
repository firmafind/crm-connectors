# Company created → firmafind → People

This workflow verifies a newly created Company through firmafind and creates linked People for its managing directors. It uses Twenty's native record operations, so no Twenty API key is required. These are setup instructions and executable Code actions, not an importable Twenty workflow export. Installation needs your workspace's field IDs and deployed Twenty version.

```text
Company created
  → Resolve company (Code)
  → Filter: matched is true
  → Register lookup (Code)
  → Filter: shouldUpdate is true
  → Update Company: FN and director summary
  → Search Records: People belonging to this company
  → Prepare People (Code)
  → Iterator: peopleToCreate
      → Create Record: Person linked to this company
```

## Configure the workflow

First create Company text fields `firmenbuchnummer` and `managingDirectors` (multiline), if they do not exist. Use a protected firmafind API key configuration available in your Twenty installation. Ordinary Code inputs may appear in run history; do not put keys in Company records or commit them in source. If your version cannot supply secrets securely, move the request into a protected server-side Logic Function before production activation.

Only the company name needs to be entered when creating a Company. Twenty supplies its generated ID automatically; the resolver discovers the FN by name. Use the variable picker for every mapping below. Test with a real Company-created event and verify that its ID and name reach the Code inputs.

1. Create a workflow named **Company created — firmafind directors**. Set its trigger to **Record is created → Company**. Do not choose “created or updated”: updates made by this workflow must not retrigger it.
2. Add **Code → Resolve company**, copying the whole [resolve-company.ts](./resolve-company.ts). Map:

   | Input | Source |
   | --- | --- |
   | `companyId` | Trigger → Company ID (`{{trigger.properties.after.id}}`) |
   | `companyName` | Trigger → Company name (`{{trigger.properties.after.name}}`) |
   | `apiKey` | Protected firmafind key |

   The resolver has no FN input. It always calls `GET /api/companies?name=…&exact=true` and requires exactly one distinct FN with the same name (case and whitespace normalized). It does not guess from a domain or fuzzy name match. `not_found` and `ambiguous` are explicit non-matching results. Remove any old `fnr` mapping from this step; `fnr` remains an output for the following Register lookup step.
3. Add a **Filter**: Resolve company → `matched` **is true**. Unmatched/ambiguous Companies remain unchanged; inspect the resolve-step result and verify the registered company name before a manual rerun.
4. Add **Code → Register lookup**, copying [lookup.ts](./lookup.ts). Map `fnr` and `companyId` from Resolve company, and `apiKey` from protected configuration. This verifies the FN and retrieves director roles. An invalid/inaccessible FN or request failure stops execution and creates no People.
5. Add a **Filter**: Register lookup → `shouldUpdate` **is true**. Inactive Companies are skipped.
6. Add **Update record → Company**. Record ID = Register lookup → `companyId`; Firmenbuchnummer = `fnr`; Managing Directors = `managingDirectorsText`. Leave the original Company name and all unrelated fields unchanged.
7. Add **Search Records → People**, filtered to **Company equals Register lookup → companyId**. Return the existing People with their `id`, `companyId`, and composite `name`. Set an adequate record limit; the next step refuses to proceed if the search is truncated. Current Twenty's Find Records output exposes `all` and `totalCount`; verify these outputs on your version.
8. Add **Code → Prepare People**, copying [prepare-people.ts](./prepare-people.ts). Map:

   | Input | Source |
   | --- | --- |
   | `companyId` | Register lookup → companyId |
   | `directors` | Register lookup → directors |
   | `existingPeople` | Search Records → All |
   | `existingPeopleTotalCount` | Search Records → Total Count |

9. Add **Iterator**, using Prepare People → `peopleToCreate` as its array. Inside the iterator add **Create record → Person**:

   | Person field | Current iterator item's value |
   | --- | --- |
   | Name → First name | `firstName` (empty) |
   | Name → Last name | `lastName` (register full name) |
   | Job title | `jobTitle` |
   | Company | `companyId` |

   firmafind currently exposes a formatted full name only. The workflow preserves that full name in Last name instead of guessing name components, titles, or surname order. Split names manually if needed. No email, phone, birth date, or private address is inferred or imported.
10. Disable “continue on error” and automatic retries on write steps. Test the entire workflow against a real company with known directors, then activate it.

## Matching and duplicate behavior

Only Geschäftsführer/Geschäftsführerinnen are imported. Prokuristen, Gesellschafter and Vorstände are excluded; an AG may consequently yield no managing directors. An empty director array creates no People.

Before creating People, the adapter compares register names with the normalized full names of People already linked to the same Company. Exact matches are skipped, including split first/last names and People from a previous run. Existing People are not overwritten, moved between companies, merged, or assigned a new job title. The same name in another company is not treated as proof of the same person's identity.

This is name-based duplicate avoidance, not a stable register person ID. Titles, comma-separated names or spelling changes may need manual review. The workflow cannot distinguish two directors with the same full name. Parallel runs can race between search and creation; run one instance per Company at a time. After a partially failed iterator, rerun the **whole workflow**, including Search Records and Prepare People, so it can skip records already created. Do not blindly retry only the failed Create Record action after an unknown write result.

Name resolution plus details normally costs 2 firmafind credits; unmatched name searches still use a search request. No match means no People creation, not proof that the business does not exist anywhere: it may have another registered name or no Austrian Firmenbuch entry.

## Test before activation

- New Company with only its registered name and one exact match → FN resolved and directors created and linked.
- No exact match or multiple FNs → no People created.
- Inactive company or request error → no People created.
- Existing linked director → skipped; other existing People preserved.
- Full rerun after a partial failure → previously created exact-name records skipped.
- Truncated People search → explicit error instead of potentially creating duplicates.

Run local tests from the repository root:

```sh
node --import tsx --test packages/crm-connectors/twenty/*.test.ts
```

Reference: [Twenty workflows](https://github.com/twentyhq/twenty/blob/main/packages/twenty-docs/getting-started/core-concepts/workflows.mdx), [Find Records output (`all`, `totalCount`)](https://github.com/twentyhq/twenty/blob/main/packages/twenty-server/src/modules/workflow/workflow-executor/workflow-actions/record-crud/find-records.workflow-action.ts).
