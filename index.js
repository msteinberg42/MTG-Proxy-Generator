let STATE = {
  mode : MODES.DISCLAIMER,
  deckList : null,
  applyToAllCopies : true
}

function setState(stateFunction) {
  STATE = stateFunction(STATE);
  renderApplication(STATE);
}

function renderApplication(state) {

  if(state.mode === MODES.DISCLAIMER) {
    showDisclaimer();

    $(".accept-terms").click(function() {
      setState(oldState => {
        oldState.mode = MODES.EDIT;
        return oldState;
      });
    });
  }

  else if(state.mode === MODES.EDIT) {

    $(".js-queryList").attr("placeholder-x",
`Supported syntax:\n\n` + syntaxText);

    $(".js-queryList").placeholder();

    showEditScreen();

    $(".js-generate-button").click(function(event) {
      event.preventDefault();

      if (!$.trim($(".js-queryList").val())) {
        $(".js-queryList").val(sampleDecklist);
      }

      $(".js-results").empty();
      addProgressBar();

      //generate a list of query...
      const queryList = generateQueryList($(".js-queryList").val().split("\n"));

      const totalRequests = queryList.length;
      let completedRequests = 0;

      showReviewScreen();

      STATE.deckList = [];

      if (totalRequests === 0) {
        STATE.mode = MODES.REVIEW;
        editReviewButtons();
        renderApplication(STATE);
        return;
      }

      queryList.forEach(function (query, i) {
        resolveCard(query)
          .then(function (result) {
            addResolvedCardToDeck(query, i, result);
          })
          .catch(function (error) {
            console.error("Failed to resolve", query, error);
            showCardError(query.originalText);
          })
          .then(function () {
            completedRequests++;
            const percentageComplete = (completedRequests / totalRequests) * 100;
            $(".progress-bar")
              .css("width", `${percentageComplete}%`)
              .attr("aria-valuenow", `${percentageComplete}`);

            if (completedRequests === totalRequests) {
              STATE.deckList = STATE.deckList.sort(function (card1, card2) {
                return card1.displayOrder - card2.displayOrder;
              });
              renderApplication(STATE);
            }
          });
      });

      STATE.mode = MODES.REVIEW;
      editReviewButtons();
    });

    $(".js-clear-button").click(function() {
      $(".js-queryList").val("");
      $(".js-queryList").scrollTop();
    });

    $(".js-review-button").click(function() {
      STATE.mode = MODES.REVIEW;
      renderApplication(STATE);
    });

  } else if(state.mode === MODES.REVIEW) {

    showReviewScreen();

    $(".progress-container").remove();

    buildSpoiler(STATE.deckList);

  } else {
    throw new Error("Invalid Mode");
  }

}

////////////////////////////////////////////////////////
//  Building cards out of ScryFall data
////////////////////////////////////////////////////////

function addResolvedCardToDeck(query, displayOrder, result) {
  const data = result && result.card;

  if (!data || !data.name) {
    showCardError(query.originalText);
    return;
  }

  // e.g. the collector number pointed at a different card than the line named
  if (result.warning) {
    showWarning(result.warning);
  }

  const card = {};

  card.name = data.name;
  card.set = data.set_name;
  card.setCode = data.set;
  card.collectorNumber = data.collector_number;
  // Every copy of the same card shares this key, which is what lets a
  // printing change propagate to all copies.
  card.cardKey = data.oracle_id || data.name;
  card.displayOrder = displayOrder;
  card.alternateImages = null;
  card.editMode = false;
  card.printsUri = data.prints_search_uri;
  card.layout = query.layout;
  // True when the user pinned an exact printing, e.g. "4 Chromatic Sphere (INV) 299"
  card.explicitPrinting = !!query.setCode;

  if (data.layout === 'transform' || data.layout === 'modal_dfc') {
    card.cardImage = (data.card_faces && data.card_faces[0].image_uris) ? data.card_faces[0].image_uris.border_crop : "";
    card.cardImage2 = (data.card_faces && data.card_faces[1].image_uris) ? data.card_faces[1].image_uris.border_crop : "";
  } else {
    if (card.layout === 'checklist') {
      card.layout = 'normal';
      showAlert(`"${card.name}" cannot be made into a checklist card. Generating standard card instead.`);
    }
    card.cardImage = (data.image_uris) ? data.image_uris.border_crop : "";
  }

  // If we already walked the full print run to find the oldest printing,
  // reuse it instead of asking ScryFall again when the user hits Edit.
  if (result.printings && result.printings.length) {
    card.alternateImages = buildAlternateImages(result.printings);
  }

  card.needsRerender = true;

  if (card.cardImage === "") {
    showCardError(query.originalText || card.name);
    return;
  }

  for (let j = 0; j < query.quantity; j++) {
    STATE.deckList.push($.extend(true, {}, card));
  }
}

function toAlternateImage(print) {
  const alternateImage = {
    set: print.set_name,
    setCode: print.set,
    collectorNumber: print.collector_number
  };

  if (print.card_faces && print.card_faces.length > 1 && print.card_faces[0].image_uris) {
    alternateImage.cardImage = print.card_faces[0].image_uris.border_crop;
    alternateImage.cardImage2 = print.card_faces[1].image_uris
      ? print.card_faces[1].image_uris.border_crop
      : "";
  } else if (print.image_uris) {
    alternateImage.cardImage = print.image_uris.border_crop;
  }

  return alternateImage;
}

// Oldest first, so "next" walks forward through history.
function buildAlternateImages(printings) {
  return sortPrintingsOldestFirst(printings.filter(hasUsableImage)).map(toAlternateImage);
}

function setLabel(card) {
  const code = card.setCode ? ` (${card.setCode.toUpperCase()})` : "";
  const number = card.collectorNumber ? ` #${card.collectorNumber}` : "";
  return `${card.set}${code}${number}`;
}

////////////////////////////////////////////////////////
//  Applying a printing to one card or to every copy
////////////////////////////////////////////////////////

function applyToAllCopiesEnabled() {
  const $toggle = $(".js-apply-to-all");
  if ($toggle.length === 0) {
    return STATE.applyToAllCopies;
  }
  return $toggle.is(":checked");
}

// Every card in the deck that should move together with `card`.
function copiesOf(card) {
  if (!applyToAllCopiesEnabled() || !STATE.deckList) {
    return [card];
  }
  return STATE.deckList.filter(function (other) {
    return other.cardKey === card.cardKey;
  });
}

function applyPrinting(card, printing) {
  copiesOf(card).forEach(function (copy) {
    copy.cardImage = printing.cardImage;
    // Only touch the back face on cards that actually have one.
    if (copy.cardImage2) {
      copy.cardImage2 = printing.cardImage2 || copy.cardImage2;
    }
    copy.set = printing.set;
    copy.setCode = printing.setCode;
    copy.collectorNumber = printing.collectorNumber;
    copy.needsRerender = true;
  });
}

// Share a fetched print run across copies so we only ask ScryFall once.
function shareAlternateImages(card, alternateImages) {
  copiesOf(card).forEach(function (copy) {
    copy.alternateImages = alternateImages;
  });
  card.alternateImages = alternateImages;
}

function currentPrintingIndex(card) {
  if (!card.alternateImages) {
    return -1;
  }
  return card.alternateImages.map(item => item.cardImage).indexOf(card.cardImage);
}

////////////////////////////////////////////////////////
//  Utility Functions:
////////////////////////////////////////////////////////

function buildSpoiler(deckList) {

  for(let i = 0; i < deckList.length; i++) {

    const card = deckList[i];
    let cardDivs, cardDiv1, cardDiv2

    // find existing cardDiv(s)
    cardDivs = $(`*[data-card="${card.name}-${i}"].card-div`);

    // if there are no matching cardDivs this is a new card, so let's create one
    if(cardDivs.length === 0) {

      // make 2 cardDivs for a 'normal' DFC
      if(card.cardImage2 && card.layout !== 'checklist') {
        $(".js-results").append(`
        <div class="card-div col-6 col-sm-4 col-md-3 col-lg-2" data-card="${card.name}-${i}">
          <div class="card-overlay d-print-none">
            <button class="edit-button btn btn-outline-light btn-sm">Edit</button>
          </div>
          <img class="normal">
        </div>

        <div class="card-div col-6 col-sm-4 col-md-3 col-lg-2" data-card="${card.name}-${i}">
          <img>
        </div>`);
        // else make a single cardDiv with checklist style img elements
      } else if(card.cardImage2 && card.layout === 'checklist') {
        // Need to add an img.normal for print-sizing reasons...
        $(".js-results").append(`
        <div class="card-div checklist col-6 col-sm-4 col-md-3 col-lg-2" data-card="${card.name}-${i}">
          <div class="card-overlay d-print-none">
            <button class="edit-button btn btn-outline-light btn-sm">Edit</button>
          </div>
          <img class="normal">
          <img class="checklist checklist-front">
          <img class="checklist-back">
        </div>`);
        // else make a single cardDiv for all other styles of cards
      } else {
        $(".js-results").append(`
        <div class="card-div col-6 col-sm-4 col-md-3 col-lg-2" data-card="${card.name}-${i}">
          <div class="card-overlay d-print-none">
            <button class="edit-button btn btn-outline-light btn-sm">Edit</button>
          </div>
          <img>
        </div>`);
      }
      //now there is at least one cardDiv, so lets save them
      cardDivs = $(`*[data-card="${card.name}-${i}"].card-div`);
    }

    cardDiv1 = $(cardDivs[0])

    if(cardDivs.length > 1) {
      cardDiv2 = $(cardDivs[1])
    }

    if(card.needsRerender) {
      const printingIndex = currentPrintingIndex(card);

      // edit mode overlay
      const cardOverlayHTML = `
        <div class="card-overlay d-print-none ${(card.editMode) ? `edit-mode` : ""}">

          ${(card.editMode) ? `<span class="set-name badge badge-dark">${setLabel(card)}</span>` : ""}

          ${(card.editMode) ? `<button class="done-button btn btn-outline-light btn-sm">Done</button>` : ""}

          ${(card.editMode) ? `<button class="prev-button btn btn-dark btn-sm"> < </button>` : ""}

          ${(card.editMode) ? `<span class="badge badge-dark image-counter"><span class="image-counter-current">${printingIndex + 1}</span> / <span class="image-counter-total">${card.alternateImages.length}</span></span>` : `<button class="edit-button btn btn-outline-light btn-sm">Edit</button>`}

          ${(card.editMode) ? `<button class="next-button btn btn-dark btn-sm"> > </button>` : ""}
        </div>`;

      //set html of layover in cardDiv
      cardDiv1.find('.card-overlay').replaceWith(cardOverlayHTML);

      // add normal card face images
      if(card.layout === 'normal') {
        cardDiv1.find('img').replaceWith(`<img class="normal" src="${card.cardImage}" alt="${card.name}">`)
        if(card.cardImage2 && cardDiv2) {
          cardDiv2.find('img').replaceWith(`<img class="normal" src="${card.cardImage2}" alt="${card.name}">`);
        }
      }

      //add checklist card face images
      if (card.layout === 'checklist') {
        if(card.cardImage) {
          // Need this 'normal' image for print-sizing reasons...
          cardDiv1.find('img.normal').replaceWith(`<img class="normal" src="${card.cardImage}" alt="${card.name}">`);
          cardDiv1.find('img.checklist-front').replaceWith(`<img class="checklist-front" src="${card.cardImage}" alt="${card.name}">`);
        }
        if (card.cardImage2) {
          cardDiv1.find('img.checklist-back').replaceWith(`<img class="checklist-back" src="${card.cardImage2}" alt="${card.name}">`);
        }
      }

      // NOTE: these handlers must be scoped to cardDiv1. Binding them with a
      // bare $(".next-button") selector (as the original did) attached one
      // handler per rerendered card to whichever button happened to be in the
      // DOM, so a single click advanced several unrelated cards.
      cardDiv1.find(".edit-button").click(function() {
        card.editMode = true;

        $(this).parent().css("opacity", "1");

        if(!card.alternateImages) {
          fetchPrintings({ prints_search_uri: card.printsUri }).then(function (printings) {
            shareAlternateImages(card, buildAlternateImages(printings));
            card.needsRerender = true;
            renderApplication(STATE);
          });
        } else {
          card.needsRerender = true;
          renderApplication(STATE);
        }
      });

      cardDiv1.find(".done-button").click(function() {
        card.editMode = false;
        card.needsRerender = true;
        renderApplication(STATE);
      });

      cardDiv1.find(".next-button").click(function() {
        const indexOfCurrentImage = currentPrintingIndex(card);
        const numAlternateImages = card.alternateImages.length;

        if(indexOfCurrentImage < numAlternateImages - 1) {
          applyPrinting(card, card.alternateImages[indexOfCurrentImage + 1]);
          renderApplication(STATE);
        }
      });

      cardDiv1.find(".prev-button").click(function() {
        const indexOfCurrentImage = currentPrintingIndex(card);

        if(indexOfCurrentImage > 0) {
          applyPrinting(card, card.alternateImages[indexOfCurrentImage - 1]);
          renderApplication(STATE);
        }
      });

      deckList[i].needsRerender = false;
    }
  }
}

////////////////////////////////////////////////////////
//  Decklist parsing
////////////////////////////////////////////////////////

// Section headers Moxfield and friends emit between blocks of cards.
const SECTION_HEADER_REGEX = /^(deck|sideboard|commander|companion|maybeboard|considering|tokens?)\s*:?\s*$/i;

// "4 Name", "4x Name", "Name"
const QUANTITY_REGEX = /^(\d+)\s*[xX]?\s+/;

// Trailing junk Moxfield can append: *F* / *E* foil markers, [Category] tags,
// and #hashtags.
const ANNOTATION_REGEX = /\s*(\*[A-Za-z]+\*|\[[^\]]*\]|#\S+)\s*/g;

// "Name (SET) 123" or "Name (SET)". The 2-6 character alphanumeric cap on the
// set code is what stops this from mangling card names that contain
// parentheses, e.g. "Erase (Not the Urza's Legacy One)".
const PRINTING_REGEX = /^(.+?)\s*\(([A-Za-z0-9]{2,6})\)(?:\s+([A-Za-z0-9★†‑-]+))?\s*$/;

function parseDecklistLine(rawLine) {
  const originalText = rawLine.trim();

  if (!originalText || originalText.startsWith("//") || SECTION_HEADER_REGEX.test(originalText)) {
    return null;
  }

  const query = { originalText: originalText, quantity: 1 };

  let remainder = originalText;

  const quantityMatch = remainder.match(QUANTITY_REGEX);
  if (quantityMatch) {
    query.quantity = parseInt(quantityMatch[1], 10);
    remainder = remainder.replace(QUANTITY_REGEX, "");
  }

  // App-specific flags. Anchored so a card name containing "-cl" survives.
  if (/(^|\s)-(cl|checklist)(\s|$)/i.test(remainder)) {
    query.layout = 'checklist';
    remainder = remainder.replace(/(^|\s)-(cl|checklist)(\s|$)/i, " ").trim();
  } else {
    query.layout = 'normal';
  }

  if (/(^|\s)-(cd|code)(\s|$)/i.test(remainder)) {
    query.queryEndpoint = 'code';
    remainder = remainder.replace(/(^|\s)-(cd|code)(\s|$)/i, " ").trim();
  }

  if (query.queryEndpoint !== 'code') {
    remainder = remainder.replace(ANNOTATION_REGEX, " ").trim();

    const printingMatch = remainder.match(PRINTING_REGEX);
    if (printingMatch) {
      remainder = printingMatch[1].trim();
      query.setCode = printingMatch[2].toLowerCase();
      if (printingMatch[3]) {
        query.collectorNumber = printingMatch[3];
      }
    }
  }

  if (!query.queryEndpoint) {
    query.queryEndpoint = 'named';
  }

  query.originalName = remainder.trim();
  query.query = query.originalName.toLowerCase();

  if (!query.query) {
    return null;
  }

  return query;
}

function sameQuery(a, b) {
  return a.query === b.query
    && a.layout === b.layout
    && a.queryEndpoint === b.queryEndpoint
    && a.setCode === b.setCode
    && a.collectorNumber === b.collectorNumber;
}

function generateQueryList(userInputArr) {

  const queryList = [];

  for(let i = 0; i < userInputArr.length; i++) {
    const query = parseDecklistLine(userInputArr[i]);
    if (!query) {
      continue;
    }

    // Merge repeated lines for the same card AND the same printing. Two lines
    // naming different printings stay separate.
    const existing = queryList.find(function (candidate) {
      return sameQuery(candidate, query);
    });

    if (existing) {
      existing.quantity += query.quantity;
    } else {
      queryList.push(query);
    }
  }

  return queryList;
}

////////////////////////////////////////////////////////
//  Screens & chrome
////////////////////////////////////////////////////////

function showAlert(message, level) {
  $(".js-results").prepend(`<div class="alert alert-${level || 'danger'} alert-dismissible fade show col-12" role="alert">
    ${message}
    <button type="button" class="close" data-dismiss="alert" aria-label="Close">
      <span aria-hidden="true">&times;</span>
    </button>
  </div>`);
}

function showWarning(message) {
  showAlert(message, 'warning');
}

function showCardError(text) {
  showAlert(`"${text}" could not be found. Try editing your list.`);
}

function showDisclaimer() {
  $(".disclaimer").prop('hidden', false);
  $(".js-input-section").prop('hidden', true);
  $(".js-results").prop('hidden', true);
  $(".js-apply-to-all-container").prop('hidden', true);
  $("footer").prop('hidden', false);
}

function showEditScreen() {
  $(".disclaimer").prop('hidden', true);
  $(".js-input-section").prop('hidden', false);
  $(".js-results").prop('hidden', true);
  $(".js-apply-to-all-container").prop('hidden', false);
  $("footer").prop('hidden', true);
}

function showReviewScreen() {
  $(".disclaimer").prop('hidden', true);
  $(".js-input-section").prop('hidden', true);
  $(".js-results").prop('hidden', false);
  $(".js-apply-to-all-container").prop('hidden', false);
  $("footer").prop('hidden', true);
}

function editReviewButtons() {
  $(".edit-review").html(`
    <div class="btn-group btn-group-toggle" data-toggle="buttons" role="radiogroup" aria-label="navigate">
      <label class="btn btn-warning js-edit-button">
        <input type="radio" name="options" id="option1" autocomplete="off" aria-label="edit" checked> Edit
      </label>
      <label class="btn btn-info active js-review-button">
        <input type="radio" name="options" id="option3" autocomplete="off" aria-label="review" checked> Review
      </label>
    </div>
  `);

  $(".js-edit-button").click(function() {
    $().addClass("focus");
    $(".js-review-button").removeClass("focus");
    showEditScreen();
  });

  $(".js-review-button").click(function() {
    $().addClass("focus");
    $(".js-edit-button").removeClass("focus");
    showReviewScreen();
  });
}

function addProgressBar() {
  $(".js-results").append(`
    <div class="progress-container w-100 p-0">
      <div class="progress">
        <div class="progress-bar" role="progressbar" style="width: 0%" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100"></div>
      </div>
    </div>
  `);
}

$(function() {
  $(".js-apply-to-all").prop("checked", STATE.applyToAllCopies).change(function () {
    STATE.applyToAllCopies = $(this).is(":checked");
  });

  renderApplication(STATE);
});
