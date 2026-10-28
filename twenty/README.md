# firmafind für Twenty-Workflows

For automatic enrichment when a Company is created and creation of linked People, use [Company created → firmafind → People](./company-created.md). The manual Company-only workflow below remains available.

Firmenbuchnummer → firmafind-Abfrage → Firmenname und Geschäftsführer im bestehenden Twenty-Firmendatensatz. Der Adapter läuft als Code-Schritt in Twenty, ohne zusätzlichen Server und ohne Twenty-API-Key. Er verwendet den bestehenden firmafind-Endpunkt; ein erfolgreicher Abruf kostet regulär 1 Credit.

## Einrichtung

1. Unter **Settings → Data model → Companies** zwei eigene Felder anlegen: `firmenbuchnummer` (Text) und `managingDirectors` (mehrzeiliger Text). Die Namen sind eine vorgeschlagene Zuordnung; vorhandene Felder können verwendet werden.
2. Einen Workflow mit **Manual**-Trigger für einen einzelnen Company-Datensatz anlegen. Für den ersten Einsatz bleibt die Aktualisierung damit bewusst manuell.
3. Einen **Code**-Schritt „firmafind lookup“ hinzufügen und den gesamten Inhalt von [lookup.ts](./lookup.ts) einfügen. Eingaben zuordnen:

   | Eingabe | Wert |
   | --- | --- |
   | `fnr` | Firmenbuchnummer des ausgelösten Company-Datensatzes |
   | `companyId` | ID desselben Datensatzes |
   | `apiKey` | firmafind API-Key aus der geschützten Konfiguration eures Workspaces |

   Die Werte mit Twentys Variablenauswahl zuordnen. API-Keys nicht in versionierten Code oder Firmenfelder schreiben. Der Adapter gibt den Key nicht zurück; prüft zusätzlich, wer in eurer Twenty-Version Code-Eingaben und Workflow-Läufe sehen kann. Falls eure Version keine geeignete Secret-Verwaltung bietet, den API-Aufruf in einen geschützten HTTP-Schritt oder eine serverseitige Logic Function verlagern, bevor ihr einen produktiven Key hinterlegt.
4. Den Code-Schritt testen. Er akzeptiert etwa `FN 123456 A`, `fn-123456a` und `123456a`. Die Beispielnummer ist synthetisch; zum Live-Test eine bekannte Firmenbuchnummer verwenden.
5. Einen **If/Else**-Schritt hinzufügen: nur fortfahren, wenn `shouldUpdate = true` und `companyId` nicht leer ist. Gelöschte/inaktive Firmen werden damit nicht überschrieben.
6. **Update record → Company** hinzufügen und folgende Werte aus dem Code-Ergebnis zuordnen:

   | Twenty-Feld | Ausgabe |
   | --- | --- |
   | Record ID | `companyId` |
   | Name | `companyName` |
   | Firmenbuchnummer | `fnr` |
   | Managing Directors | `managingDirectorsText` |

7. Workflow an einer bekannten Firma testen und danach aktivieren. Fehlerfortsetzung ausschalten; für den Code-Schritt keine automatischen Wiederholungen konfigurieren, um zusätzliche kostenpflichtige Abrufe nach nachgelagerten Fehlern zu vermeiden.

Wiederholte Ausführung aktualisiert denselben Firmendatensatz. Es werden keine Person-Datensätze angelegt und keine Namen automatisch in Vor-/Nachnamen aufgeteilt. Ein späterer automatischer Trigger sollte ausschließlich Änderungen des FN-Feldes beobachten, damit die Aktualisierung keine Schleife auslöst.

## Ausgabe und Rollen

`directors` enthält `{ fullName, role }`, `directorCount` die Anzahl und `managingDirectorsText` die Namen mit Zeilenumbruch. Zusätzlich kommen `companyId`, `fnr`, `companyName`, `isActive`, `shouldUpdate` und `sourceUrl` zurück. Kein Geburtsdatum, keine Privatadresse und kein vollständiger Registerauszug werden weitergereicht.

Das Registerfeld `management` umfasst mehrere Rollen. Der Adapter wählt ausdrücklich Geschäftsführer/Geschäftsführerinnen aus, einschließlich der Schreibweise `Geschaeftsfuehrer`. Prokuristen, Gesellschafter und Vorstände werden nicht als Geschäftsführer ausgegeben. Gleiche Namen mit gleicher Rolle werden innerhalb einer Antwort zusammengefasst; daraus wird keine personenübergreifende Identität abgeleitet. Fehlende oder unerwartete Managementdaten brechen den Schritt ab. Eine gültige leere Liste liefert leeren Text und leert bei der Feldzuordnung den bisherigen Geschäftsführertext.

Bei AGs können Vorstände statt Geschäftsführern eingetragen sein; dort ist eine leere Geschäftsführerliste möglich. Rollen werden so interpretiert, wie firmafind sie aus dem Register liefert; es wird keine zusätzliche rechtliche Prüfung oder historische Rekonstruktion vorgenommen.

## Validierung

Vom Repository-Stamm aus:

```sh
node --import tsx --test packages/crm-connectors/twenty/lookup.test.ts
```

Die Tests verwenden synthetische Registerdaten und simulieren HTTP-Antworten. Die tatsächliche Workflow-Ausführung und Feldzuordnung müssen im jeweiligen Twenty-Workspace getestet werden; sie sind von dessen Version und Schema abhängig.

Referenzen: [Twenty Workflows](https://github.com/twentyhq/twenty/blob/main/packages/twenty-docs/getting-started/core-concepts/workflows.mdx), [Twenty APIs und Workspace-Schema](https://github.com/twentyhq/twenty/blob/main/packages/twenty-docs/developers/extend/api.mdx).
