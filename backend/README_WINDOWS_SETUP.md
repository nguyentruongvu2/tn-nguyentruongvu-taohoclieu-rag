# Windows Setup (Full OCR)

This project supports 2 dependency modes on Windows:

- Default mode (easy install, no PaddleOCR):
  - `pip install -r requirements.txt`
- Full OCR mode (PaddleOCR + PaddlePaddle):
  - Enable Windows Long Paths first
  - `pip install -r requirements.windows-full.txt`

## 1) Enable Windows Long Paths

Run PowerShell as Administrator:

```powershell
New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
```

Restart Windows after setting this key.

## 2) Verify Long Paths is enabled

```powershell
Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" | Select-Object LongPathsEnabled
```

Expected value: `LongPathsEnabled : 1`

## 3) Install dependencies

From the backend folder:

```powershell
pip install -r requirements.windows-full.txt
```

## Notes

- If your local environment still fails due path/tooling restrictions, use Docker (Linux) where full OCR packages install more reliably.
- The app runs without PaddleOCR in default mode and will use fallback OCR paths.
