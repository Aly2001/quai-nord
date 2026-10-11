# Quai Nord 🚆

**Will my TER train be on time?** An end-to-end data project on regional trains (TER) in the Hauts-de-France region, built from SNCF open data.

Quai Nord continuously collects real-time SNCF data, builds a clean delay dataset, analyses punctuality station by station, and serves it through a React web app where travellers can search a journey and see the observed delay risk of each train.

![Station map](docs/carte.png)

## What it does

- **Continuous collection**: every 5 minutes, a Python collector downloads the SNCF real-time feed (GTFS-RT) and stores every train passage in SQLite, without duplicates (upsert).
- **Automated daily pipeline**: official timetables (GTFS), hourly weather (Open-Meteo), a clean delay table and per-train delay risks are rebuilt every day, triggered by the collector itself.
- **Exploratory analysis**: punctuality by hour, line, station and position along the journey, with explicit sample-size rules.
- **Web app (React)**:
  - journey search for today, tomorrow and the day after, from the chosen time onwards;
  - direct trains **and journeys with one connection**, keeping only non-dominated options;
  - for each train: the **observed delay risk**, the **forecast weather** at departure, and its **live status** (delay, cancellation);
  - **fragile connections** flagged from the data, and **broken connections** detected in real time;
  - station punctuality map and analysis pages, with data freshness always displayed.

## First findings (2 days of data, to be confirmed)

| Finding | Detail |
|---|---|
| Delays come in 5-minute steps | Almost no 1 to 4 minute delays: announcements are rounded. The model target is therefore a threshold (delay ≥ 5 min), not a number of minutes. |
| Delay accumulates along the journey | 9.2 % of passages are late at the first station, 24.0 % after the 14th. |
| Survivorship bias avoided | Starting the collection at 9 pm showed 45 % delays for 2 pm trains: only late or long trains were still in the feed. Only continuously covered periods are analysed. |
| Unit of analysis matters | 17.6 % of station passages are late, but 22.3 % of trains at their last observed station. |

## Architecture

```
SNCF GTFS-RT (every 5 min) ──► collecteur.py ──► sncf.db            (raw observations)
                                     └─────────► temps_reel.json     (live status for the app)

Daily, triggered by the collector (mettre_a_jour.py):
  1. charger_gtfs.py        SNCF timetables      ──► gtfs.db
  2. collecter_meteo.py     Open-Meteo weather   ──► meteo.db, meteo.json
  3. exporter_horaires.py   timetables per station and day, connection hubs ──► JSON
  4. construire_retards.py  clean delay table joined with weather ──► analyse.db
  5. exporter_risques.py    observed delay risk per train, line and hour ──► risques.json

                                React app (site/) reads the JSON files
```

## Tech stack

Python · SQL (SQLite) · pandas · Matplotlib · GTFS / GTFS-RT · REST APIs (Open-Meteo) · React · React Router · Vite · CSS

## Run it locally

```bash
# 1. Python side
pip install -r requirements.txt
python collecteur.py          # keeps running: collection + daily update

# 2. Web app (in another terminal)
cd site
npm install
npm run dev                   # http://localhost:5173
```

## Limits

- Only a few days of data so far: results are early trends, not conclusions.
- At most one connection per journey, in the same station.
- The displayed risk is the **observed** delay rate (per train, then per line and hour); it is not yet a machine learning prediction.
- Delay causes are not available in the feed.

## Roadmap

- [ ] Prediction model: scikit-learn baseline, then a TensorFlow sequence model following delay propagation from station to station
- [ ] FastAPI API and Docker deployment
- [ ] Cloud collection (24/7) and online deployment
- [ ] Weather vs delays analysis once several weeks of data are available

## Data and licence

Data: SNCF Voyageurs (GTFS and GTFS-RT), via transport.data.gouv.fr, under the ODbL licence.
Weather: Open-Meteo, under the CC BY 4.0 licence.
Personal project, not affiliated with SNCF.

---

**Aly Keita**, MSc student in Complex Systems Engineering (EILCO, Calais), looking for a 6-month Data Science / Data Engineering internship.
