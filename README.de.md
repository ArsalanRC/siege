# SIEGE

Ein Flipper, dessen Physik von Hand geschrieben ist. Keine Engine, keine
Physik-Bibliothek, kein Bundler, keine Abhängigkeiten. Läuft im Browser.

[English](README.md)

---

## Worum es geht

Drei Kugeln, eine Burg. Alle drei Ziele umlegen, dann hebt sich das Fallgitter.
Wer durch das offene Tor trifft, nimmt den Bergfried ein. Die Ziele stellen
sich wieder auf, der Sturm steigt eine Stufe, und alles auf dem Tisch zählt
mehr als vorher. Geht eine Kugel verloren, fängt der Sturm wieder bei eins an.

Der Tisch misst 1024 mal 1536 Einheiten. Eine Einheit entspricht einem Pixel
der Spielfläche. Im Code wird nie zwischen zwei Koordinatensystemen umgerechnet.

## Die Physik

Die ganze Simulation besteht aus einer Kugel, einer Liste von Strecken und
einer Liste von Kreisen. Kurven werden beim Aufbau des Tisches in Strecken
zerlegt. Dadurch hat die Kollisionsauflösung zwei Fälle statt neun. Zwei Fälle
kann man noch im Kopf behalten.

Nichts davon ist nach Gefühl eingestellt. Die Zahlen stammen von einem echten
Automaten:

| | |
|---|---|
| Spielfläche | 20,25 Zoll breit, gezeichnet mit 1024 Einheiten, also **1992 Einheiten pro Meter** |
| Kugel | 1,0625 Zoll Durchmesser, also **27 Einheiten** Radius |
| Schwerkraft | `9,81 · sin(6,5°)`, die Neigung eines eingestellten Tisches, also **2213 Einheiten/s²** |
| Flipper | 3 Zoll lang, 60 Grad in 35 Millisekunden, also **32 rad/s** |

Ein Flipper ist eine Kapsel, die um einen Drehpunkt schwingt. Die Physik
addiert die Oberflächengeschwindigkeit am Berührungspunkt, bevor sie den Abprall
rechnet. Nichts bevorzugt die Spitze. Das ergibt sich von selbst aus `omega · r`.
Genau deshalb lohnt sich ein Schuss von der Spitze, und niemand musste das
irgendwo aufschreiben.

### Warum die Zwischenschritte berechnet werden

Die Kollision ist diskret. Jeder Zwischenschritt bewegt die Kugel und fragt
dann, womit sie sich überschneidet. Das hat genau einen Fehlerfall: Bewegt sich
die Kugel weiter als ihr eigener Radius, fliegt sie durch die Wand hindurch. Es
gibt keine Fehlermeldung. Die Kugel ist einfach weg.

Eine hart geschossene Kugel erreicht rund 6 m/s, also 12000 Einheiten pro
Sekunde. Bei festen 240 Hz sind das 50 Einheiten pro Schritt bei 27 Einheiten
Radius. Sie tunnelt also. Alles mit 1000 Hz zu rechnen würde den schlimmsten
Fall dauerhaft bezahlen, obwohl die Kugel meistens langsam ist.

Also richtet sich die Anzahl der Schritte nach der Geschwindigkeit, und nie
wird mehr als ein halber Radius auf einmal zurückgelegt. Eine ruhende Kugel
kostet einen Schritt, eine abgeschossene vierzig.

Die Framedauer wird in `step` selbst begrenzt, nicht beim Aufrufer. Ein Tab im
Hintergrund liefert beim Aufwachen vier Sekunden am Stück. Vorher stand diese
Zusicherung nur als Kommentar da, der zur Vorsicht mahnte. So verschwindet eine
Sicherheitsgarantie still und leise.

## Starten

```sh
pnpm install
pnpm test        # 77 Tests, alle ohne Browser
pnpm typecheck
pnpm build:site  # legt die Engine nach site/lib
```

Danach `site/` mit einem beliebigen Server ausliefern. Ausser `tsc` gibt es
keinen Build. Die Seite lädt die kompilierte Engine direkt. Gespielt wird also
genau der Code, gegen den auch die Tests laufen.

## Aufbau

```
src/engine/   reines TypeScript. Kein DOM, kein Framework, keine Abhängigkeit
  vec.ts        2D-Vektoren
  shapes.ts     Strecken, Kreise, Kontakte, Kurvenzerlegung
  physics.ts    Integration, Kollisionsauflösung, Zwischenschritte
  flipper.ts    die beiden beweglichen Flächen
  table.ts      SIEGE, als Daten
  game.ts       Kugeln, Punkte, der Sturm
tests/        vitest
site/         handgeschriebenes HTML, CSS und JS
```

`src` schreibt `.js` an die eigenen Importe. Damit läuft die Ausgabe von `tsc`
unverändert im Browser.

## Zur Grafik

Die Grafik der Spielfläche ist optional und wird aus `site/art/` geladen, falls
vorhanden. Sonst zeichnet sich der Tisch aus seiner eigenen Kollisionsgeometrie.
Die Wände auf dem Bildschirm sind also die Wände, an denen die Kugel abprallt.
Das ergibt sich aus der Konstruktion und nicht daraus, dass zwei Beschreibungen
mühsam synchron gehalten werden.

---

MIT. Gebaut von [Arsalan Khadim](https://github.com/ArsalanRC).
