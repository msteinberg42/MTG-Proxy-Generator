const MODES = {
  DISCLAIMER : "disclaimer",
  EDIT : "edit",
  REVIEW : "review"
}

const SCRYFALL_SEARCH_URL = "https://api.scryfall.com/cards/";

// Scryfall asks for 50-100ms between requests. Keep this at or above 100.
const SCRYFALL_REQUEST_DELAY = 100;

// Printings that shouldn't be picked as the "oldest" default. They are
// still reachable by cycling through printings in edit mode.
const EXCLUDED_SET_TYPES = ["memorabilia"];
const EXCLUDED_BORDER_COLORS = ["gold"];

const syntaxText = `Black Lotus (single card)
4 Counterspell (creates 4 cards)
4 Chromatic Sphere (INV) 299 (Moxfield export: exact set + collector number)
4 Allied Strategies (PLS) (Moxfield export: set only, oldest printing in that set)
Shatterskull Smashing (creates a card for each face)
Jace, Vryn's Prodigy -checklist (creates a single 'checklist' style card enabled by the -checklist or -cl flag)
LEB/233 -code (finds card #233 in Limited Edition Beta, enabled by the -code or -cd flag)

When no set is given, the OLDEST printing is used.`;

// Used when Generate is pressed with an empty textarea. This was referenced by
// index.js but never defined, which threw a ReferenceError on an empty list.
const sampleDecklist = `4 Allied Strategies (PLS) 20
4 Chromatic Sphere (INV) 299
3 Collective Restraint (INV) 49
4 Evasive Action (APC) 23
4 Counterspell
1 Black Lotus`;
