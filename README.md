# MTG-Proxy-Generator
## Try the Live App Below:
[MTG Proxy-Generator](https://philo-jh.github.io/MTG-Proxy-Generator/)
## How to Use:
Ever wondered how your deck would play if you just had those couple of cards? Now you can try them out before you buy with MTG Proxy-Generator! Create proxy versions of cards or even decks to playtest before purchasing. Just enter a list in MTGO format with one card name per line. You can then print them out 9 on a page and insert them over other cards in sleeves to playtest.
## Moxfield Export Support

Paste a Moxfield export straight in. Lines carrying a set code and collector number resolve to that exact printing:

```
4 Allied Strategies (PLS) 20
4 Chromatic Sphere (INV) 299
3 Collective Restraint (INV) 49
4 Evasive Action (APC) 23
```

Foil markers (`*F*`), category tags (`[Lands]`), section headers (`Deck`, `Sideboard`, `Commander`) and `//` comments are ignored. `4x Name` works alongside `4 Name`. A set code with no collector number (`3 Allied Strategies (PLS)`) pulls that card from that set.

If the collector number points at a different card than the line names — the two sources drift on some promos — the card name wins and a warning tells you which printing was substituted.

## Oldest Printing by Default

When a line names no set, the **oldest** printing is used rather than the newest. Digital-only cards, gold-bordered World Championship decks, Collectors' Edition, and oversized cards are skipped when picking that default; they remain reachable by cycling printings in edit mode.

## Printing Changes Apply to Every Copy

Changing a card's printing in edit mode updates **all copies of that card** in the deck. Turn this off with the *Apply printing changes to all copies* checkbox in the header to change one copy at a time.

## Import Decks Using Easy MTGO Syntax
![edit screen](Screenshots/3.png)
## Create Proxy-Versions of Decks You'd Like to Test
![review screen](Screenshots/1.png)
## Choose Whatever Print Your Heart Desires!
![review screen](Screenshots/2.png)
## Technology Used:
This app was built with HTML, CSS, Javascript, jQuery, and Bootstrap. Thanks to the awesome ScryFall API for the database!
