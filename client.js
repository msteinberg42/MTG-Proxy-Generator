////////////////////////////////////////////////////////
//  ScryFall client
//
//  All requests funnel through a single serialized queue so we stay inside
//  ScryFall's requested rate limit (50-100ms between calls). The old code
//  called setTimeout(getDataFromScryFall(...), 50), which evaluated the
//  request immediately and threw the (undefined) return value at setTimeout,
//  so nothing was ever actually throttled.
////////////////////////////////////////////////////////

let scryfallQueue = Promise.resolve();

function scryfallGet(url, params) {
  const response = scryfallQueue.then(function () {
    return Promise.resolve($.getJSON(url, params || null));
  });

  // Keep the queue alive even when a request 404s, and space out the next one.
  scryfallQueue = response
    .catch(function () { /* swallow: handled by the caller */ })
    .then(function () {
      return new Promise(function (resolve) {
        setTimeout(resolve, SCRYFALL_REQUEST_DELAY);
      });
    });

  return response;
}

// ScryFall returns 404 as a rejected jqXHR. Turn a rejection into `null` so
// callers can chain fallbacks without a pile of nested error handlers.
function orNull(promise) {
  return promise.then(function (data) { return data; }, function () { return null; });
}

function fetchPrintings(card) {
  if (!card || !card.prints_search_uri) {
    return Promise.resolve([]);
  }
  // prints_search_uri is already ?order=released&unique=prints; dir=asc puts
  // the earliest release first.
  const separator = card.prints_search_uri.indexOf("?") === -1 ? "?" : "&";
  return orNull(scryfallGet(card.prints_search_uri + separator + "dir=asc"))
    .then(function (result) {
      return (result && result.data) ? result.data : [];
    });
}

function hasUsableImage(print) {
  if (!print) {
    return false;
  }
  if (print.image_uris && print.image_uris.border_crop) {
    return true;
  }
  if (print.card_faces && print.card_faces.length > 1) {
    return !!(print.card_faces[0].image_uris && print.card_faces[0].image_uris.border_crop);
  }
  return false;
}

function isOrdinaryPrinting(print) {
  if (print.digital) {
    return false;
  }
  if (print.games && print.games.indexOf("paper") === -1) {
    return false;
  }
  if (print.oversized) {
    return false;
  }
  if (EXCLUDED_SET_TYPES.indexOf(print.set_type) !== -1) {
    return false;
  }
  if (EXCLUDED_BORDER_COLORS.indexOf(print.border_color) !== -1) {
    return false;
  }
  return true;
}

function byReleaseDateAscending(a, b) {
  const dateA = a.released_at || "9999-12-31";
  const dateB = b.released_at || "9999-12-31";
  if (dateA !== dateB) {
    return dateA < dateB ? -1 : 1;
  }
  // Stable-ish tiebreak so the same list always resolves the same way.
  return (a.set || "").localeCompare(b.set || "");
}

function sortPrintingsOldestFirst(printings) {
  return printings.slice().sort(byReleaseDateAscending);
}

// Pick the earliest printing that a person would actually want to proxy:
// no digital-only cards, no gold-bordered World Championship decks, no
// Collectors' Edition, no oversized. Falls back to the unfiltered list if
// that leaves us with nothing (Un-sets, for example).
function pickOldestPrinting(printings) {
  const usable = printings.filter(hasUsableImage);
  if (usable.length === 0) {
    return null;
  }
  const ordinary = usable.filter(isOrdinaryPrinting);
  const pool = ordinary.length > 0 ? ordinary : usable;
  return sortPrintingsOldestFirst(pool)[0];
}

////////////////////////////////////////////////////////
//  Card resolution
////////////////////////////////////////////////////////

function fetchByCode(rawQuery) {
  return orNull(scryfallGet(SCRYFALL_SEARCH_URL + rawQuery));
}

function fetchBySetAndNumber(setCode, collectorNumber) {
  return orNull(scryfallGet(SCRYFALL_SEARCH_URL + encodeURIComponent(setCode) + "/" + encodeURIComponent(collectorNumber)));
}

function normalizeCardName(name) {
  return (name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Guard against a set + collector number that points at a different card than
 * the one named on the line. ScryFall happily returns whatever lives at that
 * slot, so "Sol Ring (LTC) 273" would silently print Arcane Signet.
 */
function nameMatchesCard(requestedName, card) {
  if (!requestedName || !card || !card.name) {
    return false;
  }

  const wanted = normalizeCardName(requestedName);
  if (!wanted) {
    return false;
  }

  const candidates = [card.name];

  // Split and double-faced cards are named "Front // Back" but decklists
  // usually only carry one of the two.
  if (card.name.indexOf("//") !== -1) {
    card.name.split("//").forEach(function (part) { candidates.push(part); });
  }
  if (card.card_faces) {
    card.card_faces.forEach(function (face) { candidates.push(face.name); });
  }
  if (card.printed_name) {
    candidates.push(card.printed_name);
  }

  return candidates.some(function (candidate) {
    return normalizeCardName(candidate) === wanted;
  });
}

function fetchByName(name, setCode) {
  const params = { fuzzy: name };
  if (setCode) {
    params.set = setCode;
  }
  return orNull(scryfallGet(SCRYFALL_SEARCH_URL + "named", params));
}

/**
 * Resolve one parsed query line into { card, printings }.
 *
 * `printings` is only populated when we had to look at the full print run
 * (i.e. when the user did not name a specific printing). It gets reused as
 * the edit-mode alternate image list so we don't request it twice.
 */
function resolveCard(query) {
  // Legacy "-code" flag, e.g. "LEB/233 -code"
  if (query.queryEndpoint === "code") {
    return fetchByCode(query.query).then(function (card) {
      return { card: card, printings: null };
    });
  }

  // Moxfield style: name + (SET) + collector number
  if (query.setCode && query.collectorNumber) {
    const upperSet = query.setCode.toUpperCase();

    return fetchBySetAndNumber(query.setCode, query.collectorNumber)
      .then(function (card) {
        if (card && nameMatchesCard(query.query, card)) {
          return { card: card, printings: null };
        }

        // Either the slot is empty or it holds a different card. Try the name
        // inside the requested set before giving up on the set entirely.
        return fetchByName(query.query, query.setCode).then(function (inSet) {
          if (inSet) {
            return {
              card: inSet,
              printings: null,
              warning: `#${query.collectorNumber} in ${upperSet} is not "${query.originalName || query.query}". Used ${inSet.set_name} #${inSet.collector_number} instead.`
            };
          }

          return fetchByName(query.query).then(function (anySet) {
            if (!anySet) {
              return { card: null, printings: null };
            }
            return {
              card: anySet,
              printings: null,
              warning: `"${query.originalName || query.query}" was not found in ${upperSet}. Used ${anySet.set_name} #${anySet.collector_number} instead.`
            };
          });
        });
      });
  }

  // Set given without a collector number: the printing from that set.
  if (query.setCode) {
    return fetchByName(query.query, query.setCode)
      .then(function (card) {
        if (card) {
          return { card: card, printings: null };
        }
        return fetchByName(query.query).then(function (anySet) {
          if (!anySet) {
            return { card: null, printings: null };
          }
          return {
            card: anySet,
            printings: null,
            warning: `"${query.originalName || query.query}" was not found in ${query.setCode.toUpperCase()}. Used ${anySet.set_name} instead.`
          };
        });
      });
  }

  // No printing specified: resolve the name, then walk the full print run and
  // take the oldest one.
  return fetchByName(query.query).then(function (card) {
    if (!card) {
      return { card: null, printings: null };
    }
    return fetchPrintings(card).then(function (printings) {
      const oldest = pickOldestPrinting(printings);
      return {
        card: oldest || card,
        printings: printings.length ? printings : null
      };
    });
  });
}
