# AGENTS.md

## Projektüberblick

Dieses Repository enthält ein Homebridge-Plugin für Yamaha `WXC-50` und `WXA-50`. Das npm-Paket heißt `homebridge-yamaha-wxc-wxa-50`. Das Plugin registriert die Homebridge-Plattform `YamahaWxcWxa50` und veröffentlicht pro konfiguriertem Gerät ein externes HomeKit-Accessory vom Typ `AUDIO_RECEIVER`.

Primäre Funktionen:

- Ein- und Ausschalten des Geräts
- Quellenwahl
- Lautstärke- und Mute-Steuerung
- optionale Zusatz-Accessories für Lautstärke als `Lightbulb` oder `Fan`
- robuste Input-Erkennung auch dann, wenn Yamaha keine klassischen AVR-Inputnamen zurückliefert

## Laufzeit und Abhängigkeiten

- Node.js: `>=10.17.0`
- Homebridge: `>=1.1.6`
- Hauptabhängigkeiten:
  - `yamaha-nodejs` für die Gerätekommunikation
  - `node-persist` für persistente Geräte- und Statusdaten
- Dev-Tooling:
  - `eslint`

Es gibt aktuell keine automatisierten Tests. Die einzige vorhandene Standardprüfung ist `npm run lint`.

## Architektur

### Einstiegspunkt

`index.js` registriert die Homebridge-Plattform und initialisiert die Plattformklasse `YamahaWxcWxa50`.

Wichtige Aufgaben dort:

- Lesen der Plattformkonfiguration aus Homebridge
- Setzen von `statePollingInterval` mit Minimum `3`
- Initialisierung des Persistenzpfads
- Ergänzung einer projektspezifischen Logging-Hilfsmethode `log.easyDebug`
- Start des eigentlichen Device-Setups über `api.on('didFinishLaunching', AVR.init.bind(this))`

### Geräteinitialisierung

`lib/avr.js` übernimmt die Laufzeitinitialisierung:

- initialisiert `node-persist`
- lädt `cachedDevices` und `cachedStates`
- entfernt gecachte Geräte, die nicht mehr in der Konfiguration vorkommen
- verbindet sich pro konfiguriertem Gerät via `yamaha-nodejs`
- liest Systeminformationen wie `System_ID`, Modell und `Feature_Existence`
- prüft, ob das erkannte Modell zu den unterstützten Geräten gehört
- erzeugt Input-Listen aus `Feature_Existence`, wenn `System.Config.Name.Input` fehlt
- erstellt anschließend das `Receiver`-Accessory

Wichtig: Es gibt keine echte Auto-Discovery. Geräte werden nur aus `config.receivers` geladen.

### Accessory-Schicht

`accessories/Receiver.js` bildet ein Gerät auf ein extern veröffentlichtes HomeKit-Accessory ab.

Verwendete Services:

- `Television`
- `InputSource`
- `TelevisionSpeaker`
- optional `Lightbulb` oder `Fan` als separates Lautstärke-Interface

Die Klasse:

- legt das Accessory inklusive `AccessoryInformation` an
- verbindet HomeKit-Characteristics mit Setter-Funktionen aus `lib/stateManager.js`
- aktualisiert Statuswerte periodisch per Polling
- speichert umbenannte Inputs und Anzeigenamen in der Persistenz

### Zustandslogik

`lib/stateManager.js` kapselt:

- Lesen des aktuellen Gerätestatus
- Umrechnung Yamaha-Lautstärke <-> HomeKit-Prozentwert
- Aktionen wie Power, Input-Wechsel, Remote Keys, Lautstärke und Mute

Wenn das Gerät nicht erreichbar ist, wird nach Möglichkeit der letzte bekannte Zustand aus `cachedStates` verwendet.

## Konfiguration

Die Homebridge-Konfiguration ist in `config.schema.json` beschrieben. Ein Beispiel steht in `config-sample.json`.

Relevante Plattformoptionen:

- `statePollingInterval`
- `debug`
- `receivers[]`

Relevante Geräteoptionen:

- `name`
- `ip`
- `volumeAccessory` (`fan` oder `bulb`)
- `minVolume` / `maxVolume`

Für den Betrieb setzt das Plugin voraus:

- statische IP des Geräts
- aktiviertes Network Standby

## Persistenz

Die Persistenz läuft nicht im Standard-Homebridge-Verzeichnis, sondern unter einem eigenen Pfad relativ zu `api.user.persistPath()`.

Gespeicherte Daten:

- `cachedDevices`: erkannte Geräte, Input-Metadaten, benutzerdefinierte Namen
- `cachedStates`: letzter bekannter Laufzeitstatus

Bei Änderungen an Konfigurations- oder Mapping-Logik sollte geprüft werden, ob bestehende Cache-Daten migriert oder bereinigt werden müssen.

## Wichtige Dateien

- `index.js`: Plattformregistrierung und Bootstrapping
- `lib/avr.js`: Geräteerkennung, Cache-Handling, Input-Mapping
- `accessories/Receiver.js`: HomeKit-Accessory und Services
- `lib/stateManager.js`: Statusabfrage und Setter-Logik
- `config.schema.json`: Homebridge-UI-Schema
- `config-sample.json`: Beispielkonfiguration
- `README.md`: öffentliche Projektbeschreibung
- `.github/workflows/release.yml`: erstellt bei Tags ein GitHub Release mit `.tgz`-Artefakt
- `RELEASE.md`: manuelle Release-Anleitung

## Entwicklungsnotizen für Agenten

- Bestehenden Code-Stil beibehalten: CommonJS, kompakte Klassen/Objektmodule, Tab-Indentation.
- Vor Änderungen an Volume-Logik immer beide Richtungen prüfen:
  - Yamaha-Werte sind intern in Zehntel-dB skaliert.
  - HomeKit-Werte laufen auf `0..100`.
- Änderungen an Inputs wirken sich auf Persistenzdaten aus; Alt-Caches können Verhalten überlagern.
- Externe Accessories werden publiziert, nicht als normales Platform-Accessory registriert.
- Das README ist knapper als der Code. Bei Widersprüchen gilt der Code.
- `WXC-50` und `WXA-50` liefern nicht immer `System.Config.Name.Input`; das Fallback über `Feature_Existence` ist zentral für die Initialisierung.
- Releases werden über Git-Tags `vX.Y.Z` erstellt; das Workflow-Artefakt ist das installierbare `.tgz` aus `npm pack`.

## Bekannte Auffälligkeiten

- Das Repository-Verzeichnis kann vom Paketnamen abweichen.
- Es gibt aktuell keine Test-Suite.
- Inputnamen können aus alten Persistenzdaten stammen; Merge-Logik muss Platzhalter sinnvoll ersetzen, echte Umbenennungen aber erhalten.
