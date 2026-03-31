Pharmacy Analytics delivery notes

Completed in this build:
- rebuilt the UI shell for better visual hierarchy and cleaner executive readability
- applied stronger pharmacy color-coding across grouped reports, dashboard cards, and staffing surfaces
- added overview / summary sections to dashboard and every tab
- redesigned the dashboard around financial KPIs and drillable action queues
- added a staffing tab using the provided staffing profile, including shared seats, temporary coverage, transition notes, and RX capacity ranges
- normalized staffing workload to a 4.5-day workweek: Monday-Thursday = 1.0 day, Friday = 0.5 day
- preserved grouped reporting, drilldown, filtering, sorting, export, SDRA handling, global price files, and manual clear controls

Validation completed in container:
- npm run check ✅
- npm run build ✅
- local startup verified ✅
- upload parsing verified with provided Seminole Pioneer, Example MTF, and Seminole on-hand files ✅

Packaging note:
- app_data/db.json was reset to a clean default state before packaging
- uploads folder was cleared before packaging
