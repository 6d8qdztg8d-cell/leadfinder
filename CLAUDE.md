# WebApp Konzept: KI-Lead-Generator für Webdesign

## Überblick

Diese WebApp wird als eigenständige Anwendung entwickelt und anschließend als Modul in ein bestehendes Programm integriert.

Ziel der Anwendung ist die **automatisierte Generierung von Leads** im Bereich Webdesign, basierend auf KI-gestützter Analyse von Unternehmen im Internet.

---

## Ziel des Programms

Das System identifiziert Unternehmen, die:

- **keine Website besitzen**
- oder eine Website haben, die:
  - veraltet ist
  - schlechtes Design aufweist
  - nicht modernen Standards entspricht

Diese Unternehmen werden als potenzielle Kunden (Leads) kategorisiert unter:

> **Kategorie: Bad Webdesign**

---

## Funktionsweise

### 1. Datensuche & Analyse

- Die KI durchsucht automatisiert das Internet nach Unternehmen
- Über eine API (z. B. OpenAI) wird jede Website analysiert
- Bewertungskriterien:
  - Design (modern vs. veraltet)
  - Struktur & UX
  - Mobile Optimierung
  - Performance
  - Vorhandensein einer Website

---

### 2. Lead-Erstellung

Für jeden gefundenen Lead werden automatisch extrahiert:

- Firmenname
- Website (falls vorhanden)
- E-Mail-Adresse
- Telefonnummer (falls verfügbar)
- weitere relevante Kontaktdaten

Diese Daten werden direkt im Programm als Lead gespeichert.

---

### 3. Lead-Management (User-Interaktion)

Der Nutzer kann jeden Lead:

- ✅ **Annehmen**
- ❌ **Ablehnen**

---

### 4. Dynamisches Lead-System (Wichtig!)

Um Effizienz und Übersicht zu gewährleisten:

- Es werden **immer genau 20 Leads gleichzeitig angezeigt**
- Sobald ein Lead:
  - **angenommen wird** → wird sofort ein neuer generiert
  - **abgelehnt wird** → wird ebenfalls sofort ein neuer generiert

👉 Dadurch wird sichergestellt:
- Kein Warten auf neue Leads
- Keine Überflutung mit unendlich vielen Leads
- Stetiger, kontrollierter Flow

---

## Vorteile des Systems

- Vollautomatische Lead-Generierung
- Fokus auf **hochrelevante Kunden (schlechte oder fehlende Websites)**
- Zeitersparnis durch KI-Automation
- Konstante Lead-Verfügbarkeit ohne Wartezeiten
- Saubere und übersichtliche Pipeline

---

## Integration

- Die WebApp wird als Modul gebaut
- Anschließend Integration in ein bestehendes Hauptprogramm
- Kommunikation über API oder interne Schnittstelle möglich

---

## Erweiterungsmöglichkeiten

- Scoring-System für Leads (z. B. 1–10 Qualität)
- Automatische E-Mail-Vorschläge für Outreach
- CRM-Integration
- Filter nach Branche / Region
- Historie von angenommenen / abgelehnten Leads

---

## Zusammenfassung

Dieses System kombiniert:

- Web-Scraping
- KI-Analyse
- Automatisiertes Lead-Management

um gezielt Unternehmen zu identifizieren, die Bedarf an einer neuen oder verbesserten Website haben – effizient, skalierbar und ohne manuelle Recherche.