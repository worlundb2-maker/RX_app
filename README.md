# Pharmacy Analytics Foundation Rebuild

This package is prepared for local Windows use.

## Open the app
1. Download `Pharmacy Analytics.exe` from the latest release package.
2. Double-click `Pharmacy Analytics.exe`.
3. The desktop window opens directly (no Command Prompt needed).

## Local-only behavior
- The app runs only on `127.0.0.1`.
- All data stays on the local machine.
- Uploaded files, persistence, drilldown, and manual clear behavior remain local.
- No cloud services are required.

## Data location
Runtime data is stored in the current Windows user profile under:
- `%APPDATA%\Pharmacy Analytics\local-data`

If startup fails, the launcher opens those logs automatically in Notepad.

If Windows blocks the EXE completely, use `Open Pharmacy Analytics.bat` in the same folder as a fallback launcher.
