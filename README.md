# Download Router

<div align="center">
  <p>A free, open-source Chrome extension that automatically routes your downloads into organized folders based on custom priority rules — by domain, file type, or filename pattern.</p>
  <img width="400" alt="Screenshot 2026-05-02 at 01 33 47" src="https://github.com/user-attachments/assets/3a90012d-46ca-4316-8552-56c903ad7113" />
  &nbsp;&nbsp;
  <img width="400" alt="Screenshot 2026-05-02 at 01 39 56" src="https://github.com/user-attachments/assets/fa0e2301-4201-49a1-8998-4ae79169b7be" />
</div>

## Features

- **Priority-based rules** — define which rules take precedence when multiple match a download
- **Three match types** — route by domain (e.g. `gameassets.com`), file extension (e.g. `.png`), or regex pattern
- **Right-click to route** — use "Save Image with Router" on any image to bypass the native save dialog and apply your rules
- **Drag to reorder** — visually reprioritize rules by dragging cards
- **Toggle rules on/off** — disable rules without deleting them
- **All local** — rules are stored in Chrome sync storage, no server involved

## How It Works

Downloads are intercepted before the filename is determined. The extension checks each enabled rule in priority order and reroutes the file into the matching folder inside your default Downloads directory.

**Example:**

| Priority | Match                     | Folder        |
| -------- | ------------------------- | ------------- |
| 1        | `gameassets.com` (domain) | `/gameassets` |
| 2        | `.png` (extension)        | `/pictures`   |

A `.png` downloaded from `gameassets.com` lands in `Downloads/gameassets` — P1 wins.

## Installation

1. Clone or download this repo
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer Mode** (top-right toggle)
4. Click **Load unpacked** and select the project folder

## Roadmap

- [ ] Support saving outside the default Downloads folder
- [ ] Light & Dark mode
- [ ] UI improvements
- [ ] Export Rules to JSON
- [ ] More file options to download with Router (.pdf, .docx, .xlsx, etc.)
- [ ] Other browsers support (Firefox, Safari, etc.)

## Credits

- Lucide Icons
- MacOsIcons.com (Reason I made the extension in the first place)
