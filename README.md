# Chat Setup

[한국어](README.ko.md)

A SillyTavern extension that shows an **entry dialog** when you click a character, instead of dropping you straight into its last chat.
In the dialog you choose **who you are** (persona), **which chat** (new or existing) and **which lorebooks**, and then enter.
Built for phones first.

---

## Install

1. Open **Extensions** (the puzzle-piece icon) in SillyTavern.
2. Click **Install Extension**.
3. Paste this repository's URL and click **Install**.

   ```text
   https://github.com/spaceship4415/st-chat-setup
   ```

Then click a character in the character list.

---

## The dialog

```text
┌ Enter Chat ─────────────────────────┐
│ Character  Seraphina        [✎ Edit] │
│ Persona    [Alice ▼]                 │
│ Chat       ● New chat [Seraphina - Alice - …] │
│            ○ Existing chat (3)       │
│ ▼ Lorebooks                          │
│   Character  Eldoria                 │
│   Persona    none                    │
│   Chat       none                    │
│                [Enter] [Cancel]      │
└──────────────────────────────────────┘
```

Cancel, a tap outside the dialog or **Esc** closes it without changing anything.

### Persona
- **New chat:** starts with the persona SillyTavern would have picked (connected to the character → default persona → current one). The persona shown is **locked to the new chat**. Pick *Automatic* to leave it unlocked.
- **Existing chat:** starts at *Keep current (…)*, showing the persona locked to that chat. Pick another one to change it on entry, or *Unlock* to remove the lock.
- Changing the chat below re-syncs this field to that chat, so pick the chat first if you want to change an existing chat's persona.

### Chat
- **New chat:** the name is prefilled as `Character - Persona - 2026-10-03 03h08` (` (2)`, ` (3)` … added if it already exists; the date format is a setting). For characters with alternate greetings you can pick the **starting greeting**, with a preview; the others stay available as swipes. Enter on the keyboard enters the chat (ignored while an IME is composing). Names that already exist are refused, so **an existing chat is never overwritten**.
- **Existing chat:** most recent first, with date, message count and the last message (shown as plain text, without markdown or HTML). The last opened chat is marked and preselected.
  - With 4 or more chats, a **search box and sort menu** appear (recent / oldest / name / most messages; the sort is remembered).
  - Each chat has **rename** (✏️) and **delete** (🗑️) buttons. Deleting asks first and cannot be undone; the chat that is open right now cannot be deleted here.

### Lorebooks
Folded by default, with a three-line summary.

| Lorebook | Belongs to | Changing it affects |
| --- | --- | --- |
| Character | the character | **every chat** with this character |
| Persona | the persona | **every chat** using this persona |
| Chat | this chat | **this chat only** |

Character and persona lorebooks are shared, so changing them asks for confirmation first.
**Additional lorebooks** are extra books turned on together with the character's main one; they are stored in your SillyTavern settings, not in the character card.
Every lorebook field can **create a new lorebook**; existing names are refused rather than overwritten.

> ⚠️ Clearing the main lorebook of a character whose card **embeds** a lorebook makes SillyTavern delete that embedded lorebook from the card. It cannot be undone, so this is always confirmed, even with confirmations turned off.

### Edit
**✎ Edit** opens a quick editor for the card's text fields (description, personality, scenario, first message, alternate greetings, examples, main prompt override, post-history instructions, creator's notes) **without opening a chat**.
Each field (and each alternate greeting) has a ⤢ button that opens it in SillyTavern's full-screen editor; what you type there goes straight back into the field.
With the *Edit button* setting on *Full editor*, Edit skips this and opens SillyTavern's editor directly; *Both* shows an extra *ST edit* button next to Edit.
For name, avatar, tags and the rest, *Open full editor* opens SillyTavern's own editor; for a different character that also opens its last chat, because SillyTavern's editor works on the selected character.

---

## Settings

**Extensions → Chat Setup**

| Setting | What it does |
| --- | --- |
| Show the entry dialog when selecting a character | Off = vanilla behaviour, enter immediately |
| Chat selected when the dialog opens | *New chat* (default), *Existing chat (last opened)* or *Remember my last choice*. Characters without chats always start on New chat |
| Date in new chat names | *SillyTavern default* (`2026-10-03@03h08m20s063ms`), *Date* (`2026-10-03`), *Date + hour:minute* (`2026-10-03 03h08`, default) or *Date + hour:minute:second* (`2026-10-03 03h08m20s`). `:` is not allowed in file names, hence `03h08` |
| Shift/Ctrl/Alt + click opens the chat immediately | Desktop shortcut to skip the dialog |
| Also show the dialog when clicking the current character | On by default. Off = clicking the current character opens its card editor |
| Edit button | *Quick edit* (default): the quick editor, no chat opened. *Full editor*: straight to SillyTavern's editor (opens the character's last chat too, unless it is the current character). *Both*: both buttons (shortened to icon / "ST" in the small layout on phones) |
| Images in the entry dialog | *Small* (default) or *Large (side by side)*: the character and persona images shown big, at full resolution, with Edit and the persona picker below them |
| Ask before changing persona/character lorebooks | Confirm changes that also affect other chats |

---

## Notes

- Only clicks in the **character list** open the dialog. Recent chats on the welcome screen, slash commands (`/go` …) and group chats keep SillyTavern's own behaviour.
- In bulk-edit mode a click selects the character, so no dialog opens.
- While entering, the dialog stays open showing *Entering…*. If entering fails, it stays open with the reason so you can retry, and any empty chat file created by the attempt is removed.
- Developed and tested against SillyTavern 1.19.0 (`staging`). Design notes: [docs/DESIGN.md](docs/DESIGN.md) (Korean).

---

## License

See [LICENSE](LICENSE). In short: free to install and use, free to modify for your own use, and unmodified copies may be redistributed with the license. **Sharing or distributing a modified version requires prior written permission** — please open an issue to ask.
